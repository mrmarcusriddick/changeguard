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
plan = az('appservice', 'plan', 'show', '--ids', app['serverFarmId'])
if plan['sku']['name'] != 'F1':
    raise RuntimeError('Expected F1 web hosting')
pg = az('postgres', 'flexible-server', 'show', '--resource-group', infra.GROUP, '--name', name + '-pg')
if pg['state'] != 'Ready' or pg['sku']['name'] != 'Standard_B1ms' or infra.postgres_storage_gb(pg) != 32 or pg['storage']['autoGrow'] != 'Disabled':
    raise RuntimeError('PostgreSQL is not ready with authorized sizing')
settings = {s['name']: s['value'] for s in az('webapp', 'config', 'appsettings', 'list', '--resource-group', infra.GROUP, '--name', name)}
if settings.get('PGHOST') != pg['fullyQualifiedDomainName'] or settings.get('PGSSLMODE') != 'verify-full' or not settings.get('PGPASSWORD'):
    raise RuntimeError('PostgreSQL connection settings are incomplete')
auth = az('webapp', 'auth', 'show', '--resource-group', infra.GROUP, '--name', name)
if not auth['platform']['enabled'] or not auth['globalValidation']['requireAuthentication'] or not auth['identityProviders']['azureActiveDirectory']['registration'].get('clientId'):
    raise RuntimeError('Entra authentication must be configured before delivery')
print('Authorized F1/PostgreSQL target and Entra configuration verified')
