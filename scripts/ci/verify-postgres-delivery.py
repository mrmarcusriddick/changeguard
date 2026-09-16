"""Fail closed before delivering a PostgreSQL package to the authorized F1 app."""
import importlib.util
import os
spec = importlib.util.spec_from_file_location('infrastructure', 'scripts/ci/azure-infrastructure.py')
infra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(infra)
az = infra.az
account = az('account', 'show')
if account['id'] != infra.SUBSCRIPTION or account['tenantId'] != infra.TENANT:
    raise RuntimeError('Unexpected Azure account')
name = os.environ['CG_APP_NAME']
app = az('webapp', 'show', '--resource-group', infra.GROUP, '--name', name)
if app.get('state') == 'QuotaExceeded' or app.get('usageState') == 'Exceeded':
    raise RuntimeError('App Service F1 quota is exceeded. Wait for quota recovery or explicitly authorize a hosting plan change; deployment stopped before upload.')
plan = az('appservice', 'plan', 'show', '--ids', app['serverFarmId'])
if plan['sku']['name'] != 'F1':
    raise RuntimeError('Expected F1 web hosting')
pg = az('postgres', 'flexible-server', 'show', '--resource-group', infra.GROUP, '--name', name + '-pg')
if pg['state'] != 'Ready' or pg['sku']['name'] != 'Standard_B1ms' or infra.postgres_storage_gb(pg) != 32 or pg['storage']['autoGrow'] != 'Disabled':
    raise RuntimeError('PostgreSQL is not ready with authorized sizing')
settings = {s['name']: s['value'] for s in az('webapp', 'config', 'appsettings', 'list', '--resource-group', infra.GROUP, '--name', name)}
if settings.get('PGHOST') != pg['fullyQualifiedDomainName'] or settings.get('PGSSLMODE') != 'verify-full' or not settings.get('PGPASSWORD'):
    raise RuntimeError('PostgreSQL connection settings are incomplete')
auth_url = (f'https://management.azure.com/subscriptions/{infra.SUBSCRIPTION}'
            f'/resourceGroups/{infra.GROUP}/providers/Microsoft.Web/sites/{name}'
            '/config/authsettingsV2/list?api-version=2024-11-01')
auth = (az('rest', '--method', 'get', '--url', auth_url).get('properties') or {})
provider = (auth.get('identityProviders') or {}).get('azureActiveDirectory') or {}
registration = provider.get('registration') or {}
if ((auth.get('platform') or {}).get('enabled') is not True
        or (auth.get('globalValidation') or {}).get('requireAuthentication') is not True
        or provider.get('enabled') is not True
        or not registration.get('clientId')):
    raise RuntimeError('Entra authsettingsV2 must enable authentication, require sign-in, and configure the Microsoft provider before delivery')
print('Authorized F1/PostgreSQL target and Entra configuration verified')
