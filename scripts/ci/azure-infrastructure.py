"""GitHub OIDC provisioning entry point. Never selects a paid fallback."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

TENANT = 'a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2'
SUBSCRIPTION = 'a2e23015-1a59-4109-9126-cd464798993f'
GROUP = 'changeguard-free'
TEMPLATE = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'changeguard-free-template.json'


def az(*args):
    result = subprocess.run(['az', *args, '--only-show-errors', '--output', 'json'],
                            text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Azure command failed')
    try:
        return json.loads(result.stdout) if result.stdout.strip() else None
    except json.JSONDecodeError as error:
        command = ' '.join(args[:3])
        raise RuntimeError(f'az {command} returned non-JSON output; deployment stopped.') from error


def inputs():
    for name in ('AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID'):
        if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', os.environ.get(name, '')):
            raise ValueError(f'Set {name} in GitHub environment azure-infrastructure (secret or variable).')
    if os.environ['AZURE_TENANT_ID'] != TENANT or os.environ['AZURE_SUBSCRIPTION_ID'] != SUBSCRIPTION:
        raise ValueError('Azure tenant/subscription settings do not match the authorized target.')
    if os.environ.get('CG_OPERATION', 'check') not in ('check', 'provision'):
        raise ValueError('Unknown operation')
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,34}', os.environ.get('CG_APP_NAME', '')):
        raise ValueError('App name must be 3–35 lowercase letters, digits or hyphens.')
    if os.environ.get('CG_OPERATION') == 'provision':
        if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', os.environ.get('CG_SQL_ADMIN_ID', '')):
            raise ValueError('Provide the SQL administrator Entra user object ID.')
        if not os.environ.get('CG_SQL_ADMIN_LOGIN', '').strip():
            raise ValueError('Provide the SQL administrator sign-in name.')


def validate_template(document):
    allowed = {'Microsoft.Web/serverfarms', 'Microsoft.Web/sites',
               'Microsoft.Web/sites/basicPublishingCredentialsPolicies',
               'Microsoft.Web/sites/config', 'Microsoft.Sql/servers',
               'Microsoft.Sql/servers/databases'}
    resources = document['resources']
    if any(r['type'] not in allowed for r in resources):
        raise ValueError('Template contains a resource outside the free infrastructure allowlist.')
    plans = [r for r in resources if r['type'] == 'Microsoft.Web/serverfarms']
    databases = [r for r in resources if r['type'] == 'Microsoft.Sql/servers/databases']
    if len(plans) != 1 or plans[0]['sku'] != {'name': 'F1', 'tier': 'Free', 'capacity': 1}:
        raise ValueError('Expected exactly one fixed F1 Free plan.')
    if len(databases) != 1:
        raise ValueError('Expected exactly one SQL free-offer database.')
    p = databases[0]['properties']
    if p.get('useFreeLimit') is not True or p.get('freeLimitExhaustionBehavior') != 'AutoPause' or p.get('maxSizeBytes') != 34359738368 or p.get('requestedBackupStorageRedundancy') != 'Local':
        raise ValueError('SQL free-only settings are missing or changed.')


def check():
    account = az('account', 'show')
    if account['id'] != SUBSCRIPTION or account['tenantId'] != TENANT:
        raise ValueError('Authenticated Azure context does not match the authorized target.')
    group = az('group', 'show', '--name', GROUP)
    for namespace in ('Microsoft.Web', 'Microsoft.Sql'):
        provider = az('provider', 'show', '--namespace', namespace)
        if provider['registrationState'] != 'Registered':
            raise ValueError(f'Subscription administrator must register {namespace}; no registration or privilege escalation is attempted.')
    subprocess.run(['az', 'bicep', 'build', '--file', 'azure/infra/free.bicep',
                    '--outfile', str(TEMPLATE)], check=True)
    validate_template(json.loads(TEMPLATE.read_text()))
    print(f'OIDC login and resource-group read access verified. Free template validated. Region: {group["location"]}.')
    print('Provision permission will be validated by ARM during the provision operation; a read check alone does not prove Contributor access.')


def provision():
    inputs()
    check()
    name = os.environ['CG_APP_NAME']
    # Inspect existing resources before applying. Never convert a paid database
    # or change a pre-existing paid plan to fit this deployment.
    for plan in az('appservice', 'plan', 'list', '--resource-group', GROUP):
        if plan['name'] == name + '-free' and plan['sku']['name'] != 'F1':
            raise ValueError('Target plan already exists on a paid SKU; stopping.')
    servers = az('sql', 'server', 'list', '--resource-group', GROUP)
    for server in servers:
        if server['name'] == name + '-sql':
            for database in az('sql', 'db', 'list', '--resource-group', GROUP, '--server', server['name']):
                if database['name'] == 'changeguard' and (database.get('useFreeLimit') is not True or database.get('freeLimitExhaustionBehavior') != 'AutoPause'):
                    raise ValueError('Existing database is not free-only; stopping.')
    parameters = {'appName': name, 'tenantId': TENANT,
                  'sqlAdministratorObjectId': os.environ['CG_SQL_ADMIN_ID'],
                  'sqlAdministratorLogin': os.environ['CG_SQL_ADMIN_LOGIN'].strip()}
    parameter_file = TEMPLATE.with_name('changeguard-free-parameters.json')
    parameter_file.write_text(json.dumps({'parameters': {k: {'value': v} for k, v in parameters.items()}}))
    common = ['--resource-group', GROUP, '--template-file', str(TEMPLATE),
              '--parameters', '@' + str(parameter_file), '--mode', 'Incremental']
    az('deployment', 'group', 'validate', *common)
    preview = az('deployment', 'group', 'what-if', '--no-pretty-print', *common)
    print(json.dumps(preview, indent=2))
    # Deploy precisely the compiled template that passed the guard; no fallback.
    az('deployment', 'group', 'create', '--name', 'changeguard-free-infrastructure', *common)
    plan = az('appservice', 'plan', 'show', '--resource-group', GROUP, '--name', name + '-free')
    database = az('sql', 'db', 'show', '--resource-group', GROUP, '--server', name + '-sql', '--name', 'changeguard')
    if plan['sku']['name'] != 'F1' or database.get('useFreeLimit') is not True or database.get('freeLimitExhaustionBehavior') != 'AutoPause':
        raise ValueError('Post-deployment verification failed. Inspect the resources immediately.')
    print('Free infrastructure provisioned and verified. Application remains stopped pending Azure SQL integration.')


if __name__ == '__main__':
    try:
        {'inputs': inputs, 'check': check, 'provision': provision}[sys.argv[1]]()
    except (RuntimeError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
