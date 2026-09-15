#!/usr/bin/env bash
# Run once per environment in Azure Commercial Cloud Shell (Bash).
set -euo pipefail
echo 'Blocked: this legacy bootstrap provisions paid resources. Use azure/FREE-TIER.md for the free-only infrastructure.' >&2
exit 1
set +x
umask 077
ENVIRONMENT=${1:?Usage: bash azure/bootstrap.sh staging|production globally-unique-app-name [region]}
APP_NAME=${2:?Supply a globally unique lowercase App Service name}
LOCATION=${3:-eastus}
[[ "$ENVIRONMENT" == staging || "$ENVIRONMENT" == production ]] || exit 2
[[ "$APP_NAME" =~ ^[a-z][a-z0-9-]{2,34}$ ]] || exit 2
TENANT_ID=a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2
SUBSCRIPTION_ID=a2e23015-1a59-4109-9126-cd464798993f
RESOURCE_GROUP="changeguard-$ENVIRONMENT"
az cloud set --name AzureCloud
az account set --subscription "$SUBSCRIPTION_ID"
test "$(az account show --query tenantId -o tsv)" = "$TENANT_ID"
for provider in Microsoft.Web Microsoft.Network Microsoft.DBforPostgreSQL; do
  az provider register --namespace "$provider" --wait --output none
done
az bicep build --file azure/infra/main.bicep --stdout >/dev/null
# Guard reruns: avoid accidentally resetting credentials on an existing environment.
if [[ "$(az group exists --name "$RESOURCE_GROUP")" == true ]]; then
  echo "Resource group already exists. Inspect/resume the existing deployment; do not rerun bootstrap."
  exit 1
fi
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
TASK_TMP=$(mktemp -d)
trap 'rm -rf "$TASK_TMP"' EXIT
AUTH_ID=$(az ad app create --display-name "$APP_NAME-signin" --sign-in-audience AzureADMyOrg --web-redirect-uris "https://$APP_NAME.azurewebsites.net/.auth/login/aad/callback" --enable-id-token-issuance true --query appId -o tsv)
az ad sp create --id "$AUTH_ID" --output none
az ad app credential reset --id "$AUTH_ID" --append --display-name app-service-login --years 1 --query password -o tsv > "$TASK_TMP/auth-secret"
openssl rand -hex 32 > "$TASK_TMP/database-secret"
python3 - "$TASK_TMP" "$APP_NAME" "$AUTH_ID" "$TENANT_ID" <<'PY'
import json, pathlib, sys
directory, app, client, tenant = sys.argv[1:]
root = pathlib.Path(directory)
values = dict(appName=app, authClientId=client, tenantId=tenant,
              authClientSecret=(root/'auth-secret').read_text().strip(),
              databasePassword=(root/'database-secret').read_text().strip())
(root/'parameters.json').write_text(json.dumps({'parameters':{k:{'value':v} for k,v in values.items()}}))
PY
az deployment group create --resource-group "$RESOURCE_GROUP" --name changeguard-initial --template-file azure/infra/main.bicep --parameters "@$TASK_TMP/parameters.json" --output none
DEPLOY_ID=$(az ad app create --display-name "$APP_NAME-github-deploy" --sign-in-audience AzureADMyOrg --query appId -o tsv)
DEPLOY_OBJECT=$(az ad sp create --id "$DEPLOY_ID" --query id -o tsv)
python3 - "$TASK_TMP/federation.json" "$ENVIRONMENT" <<'PY'
import json,sys
with open(sys.argv[1], 'w') as file:
    json.dump({'name':'github-environment','issuer':'https://token.actions.githubusercontent.com',
               'subject':'repo:mrmarcusriddick/changeguard:environment:'+sys.argv[2],
               'audiences':['api://AzureADTokenExchange']},file)
PY
az ad app federated-credential create --id "$DEPLOY_ID" --parameters "@$TASK_TMP/federation.json" --output none
APP_SCOPE="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$APP_NAME"
az role assignment create --assignee-object-id "$DEPLOY_OBJECT" --assignee-principal-type ServicePrincipal --role 'Website Contributor' --scope "$APP_SCOPE" --output none
printf '\nGitHub environment: %s\nAZURE_CLIENT_ID=%s\nAZURE_WEBAPP_NAME=%s\nAZURE_RESOURCE_GROUP=%s\n' "$ENVIRONMENT" "$DEPLOY_ID" "$APP_NAME" "$RESOURCE_GROUP"
printf 'Sign-in application ID: %s (rotate its credential before one year).\n' "$AUTH_ID"
