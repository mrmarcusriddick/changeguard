> **Current deployment:** [F1 + PostgreSQL setup](POSTGRESQL.md). Paid B1ms PostgreSQL is now authorized. The previous Azure SQL free-only instructions below are historical.

# Free-only Azure infrastructure

This supersedes the paid B1/PostgreSQL setup instructions. Do not run the original paid template. No Azure resources have been created by this change.

| Component | Configuration |
| --- | --- |
| App Service | Linux F1, fixed Free SKU, Always On off |
| Database | Azure SQL free offer, 32 GiB, `useFreeLimit: true` |
| Limit behavior | `AutoPause`: stop at the free monthly limit; never select paid overage |
| SQL identity | Entra-only authentication; no database password |
| Web identity | System-assigned managed identity |
| Paid extras | No PostgreSQL, private endpoints, DNS zones, Key Vault, monitoring workspace, custom domain, staging slots, or paid plan |

F1 provides 60 CPU minutes per day, 1 GB RAM and 1 GB storage. It is a development/test tier without a production SLA. The SQL offer provides 100,000 vCore seconds and up to 32 GB each of data and backup storage monthly. With AutoPause selected, usage stops when the free allowance is exhausted. Free-offer eligibility, remaining quota and region must be checked in your subscription. Do not fall back to a paid SKU if provisioning fails. Existing unrelated subscription charges are unaffected.

## Status and compatibility

`infra/free.bicep` defines the free infrastructure, but it is **not a working app deployment**. The existing application uses PostgreSQL syntax and the `pg` driver. Azure SQL requires a different driver, SQL Server migrations, transaction tests and managed-identity database access. The template deliberately keeps the app stopped and SQL public network access disabled until that integration is completed. It does not expose an unauthenticated placeholder application or silently start the PostgreSQL package against SQL Server.

Next implementation work: add the Azure SQL runtime adapter/migrations, initialize a restricted database user for the app identity, configure Entra sign-in, permit only the app's outbound IPs through the SQL firewall, and adapt CI/package/startup checks to the new backend. F1 does not support the prior private VNet integration. The previous PostgreSQL deployment workflows are blocked while this migration is pending.

## Provisioning from Azure Commercial Cloud Shell

### GitHub OIDC workflow

`Azure free infrastructure` uses the GitHub environment `azure-infrastructure`. Set `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID` as environment secrets (variables are also accepted). Its federated identity subject must be `repo:mrmarcusriddick/changeguard:environment:azure-infrastructure`. Allow the working branch in that environment if testing before merge.

Pushes affecting this workflow or its template/script run **connection checks only**. The check validates OIDC login, the target resource group, provider registration, and compiled free-tier settings. It never provisions on push. Once the workflow exists on the default branch, use Actions → Azure free infrastructure → Run workflow → `provision`, providing a globally unique app name and the SQL administrator's Entra **user** object ID and sign-in name. These identify the database administrator; they are not the deployment application's client ID. Find them in Entra ID → Users → your user → Overview.

Provisioning runs ARM validation and what-if, then applies the same compiled template in incremental mode and verifies free-tier settings. No subscription-wide Contributor access, paid fallback, or automatic provider registration is used. Azure offer/quota failures stop the workflow. The app remains stopped until the SQL adapter and sign-in integration are ready.

### Cloud Shell alternative

The current coding session has GitHub write access, but no authenticated Azure session. A subscription ID does not confer Azure permissions. To review/provision the infrastructure, use Bash Cloud Shell signed into tenant `a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2`, clone this branch, and run from the repository root. Choose a globally unique app name and the region already used for any SQL free-offer databases in this subscription.

```bash
az cloud set --name AzureCloud
az account set --subscription a2e23015-1a59-4109-9126-cd464798993f
test "$(az account show --query tenantId -o tsv)" = a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2
CG_APP=changeguard-mr-free
CG_REGION=eastus
CG_ADMIN_ID=$(az ad signed-in-user show --query id -o tsv)
CG_ADMIN_LOGIN=$(az ad signed-in-user show --query userPrincipalName -o tsv)
az group create --name changeguard-free --location "$CG_REGION"
az deployment group what-if --resource-group changeguard-free \
  --template-file azure/infra/free.bicep \
  --parameters appName="$CG_APP" sqlAdministratorObjectId="$CG_ADMIN_ID" sqlAdministratorLogin="$CG_ADMIN_LOGIN"
# After reviewing the resource list and confirming free-offer availability:
az deployment group create --resource-group changeguard-free \
  --template-file azure/infra/free.bicep \
  --parameters appName="$CG_APP" sqlAdministratorObjectId="$CG_ADMIN_ID" sqlAdministratorLogin="$CG_ADMIN_LOGIN"
az sql db show --resource-group changeguard-free --server "$CG_APP-sql" --name changeguard \
  --query '{free:useFreeLimit,exhaustion:freeLimitExhaustionBehavior,size:maxSizeBytes}'
az appservice plan show --resource-group changeguard-free --name "$CG_APP-free" --query sku
```

Expected database settings: `free=true`, `exhaustion=AutoPause`, size `34359738368`. Expected App Service SKU: `F1` / `Free`. ARM what-if is a resource-change preview, not a billing estimate. Keep paid Defender plans, paid logging, and additional resources off; do not enable a trial that later becomes paid. The free SQL offer requires the same region for all free-offer databases in a subscription.

Sources: [App Service Linux free pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/), [Azure SQL free offer and limits](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql), [SQL database ARM properties](https://learn.microsoft.com/en-us/azure/templates/microsoft.sql/servers/databases).
