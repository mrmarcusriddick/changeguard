"""GitHub OIDC provisioning entry point. Fixed F1 web plan and explicitly authorized B1ms PostgreSQL."""
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys

TENANT = 'a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2'
SUBSCRIPTION = 'a2e23015-1a59-4109-9126-cd464798993f'
GROUP = 'changeguard-free'
TEMPLATE = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'changeguard-postgres-template.json'


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


def postgres_storage_gb(server):
    """CLI uses storageSizeGb; ARM templates use storageSizeGB."""
    storage = server.get('storage') or {}
    values = [storage[key] for key in ('storageSizeGb', 'storageSizeGB') if key in storage]
    if not values or any(type(value) is not int or value <= 0 for value in values) or len(set(values)) != 1:
        raise ValueError('PostgreSQL storage size is missing, invalid, or inconsistent; stopping.')
    return values[0]


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
    if not re.fullmatch(r'[a-z0-9]+', os.environ.get('CG_POSTGRES_LOCATION', 'eastus')):
        raise ValueError('PostgreSQL location must be an Azure region name, such as eastus.')
    if os.environ.get('CG_OPERATION') == 'provision':
        for name in ('CG_DATABASE_PASSWORD', 'CG_AUTH_CLIENT_ID', 'CG_AUTH_CLIENT_SECRET'):
            if not os.environ.get(name, '').strip():
                raise ValueError(f'Set {name} in GitHub environment azure-infrastructure secrets.')
        password = os.environ['CG_DATABASE_PASSWORD']
        if not 16 <= len(password) <= 128 or sum(bool(re.search(pattern, password)) for pattern in (r'[a-z]', r'[A-Z]', r'[0-9]', r'[^a-zA-Z0-9]')) < 3:
            raise ValueError('Database password must be 16–128 characters and use at least three character classes.')
        if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', os.environ['CG_AUTH_CLIENT_ID']):
            raise ValueError('CG_AUTH_CLIENT_ID must be the sign-in application client ID.')


def validate_template(document):
    allowed = {'Microsoft.Web/serverfarms', 'Microsoft.Web/sites',
               'Microsoft.Web/sites/basicPublishingCredentialsPolicies',
               'Microsoft.Web/sites/config', 'Microsoft.DBforPostgreSQL/flexibleServers',
               'Microsoft.DBforPostgreSQL/flexibleServers/databases',
               'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules'}
    resources = document['resources']
    if any(r['type'] not in allowed for r in resources):
        raise ValueError('Template contains a resource outside the authorized allowlist.')
    plans = [r for r in resources if r['type'] == 'Microsoft.Web/serverfarms']
    servers = [r for r in resources if r['type'] == 'Microsoft.DBforPostgreSQL/flexibleServers']
    if len(plans) != 1 or plans[0]['sku'] != {'name': 'F1', 'tier': 'Free', 'capacity': 1}:
        raise ValueError('Expected exactly one fixed F1 Free plan.')
    if len(servers) != 1 or servers[0]['sku'] != {'name': 'Standard_B1ms', 'tier': 'Burstable'}:
        raise ValueError('Expected exactly one B1ms PostgreSQL server.')
    p = servers[0]['properties']
    if p['storage'] != {'storageSizeGB': 32, 'autoGrow': 'Disabled'} or p['backup'] != {'backupRetentionDays': 7, 'geoRedundantBackup': 'Disabled'} or p['highAvailability']['mode'] != 'Disabled':
        raise ValueError('PostgreSQL cost controls changed.')


def check():
    account = az('account', 'show')
    if account['id'] != SUBSCRIPTION or account['tenantId'] != TENANT:
        raise ValueError('Authenticated Azure context does not match the authorized target.')
    group = az('group', 'show', '--name', GROUP)
    for namespace in ('Microsoft.Web', 'Microsoft.DBforPostgreSQL'):
        provider = az('provider', 'show', '--namespace', namespace)
        if provider['registrationState'] != 'Registered':
            raise ValueError(f'Subscription administrator must register {namespace}; no registration or privilege escalation is attempted.')
    subprocess.run(['az', 'bicep', 'build', '--file', 'azure/infra/postgres.bicep',
                    '--outfile', str(TEMPLATE)], check=True)
    validate_template(json.loads(TEMPLATE.read_text()))
    print(f'OIDC login and resource-group read access verified. F1/B1ms template validated. App region: {group["location"]}; PostgreSQL region: {os.environ.get("CG_POSTGRES_LOCATION", "eastus")}.')
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
    servers = az('postgres', 'flexible-server', 'list', '--resource-group', GROUP)
    for server in servers:
        if server['name'] == name + '-pg':
            if server['sku']['name'] != 'Standard_B1ms' or postgres_storage_gb(server) != 32:
                raise ValueError('Existing PostgreSQL server has different sizing; stopping without resizing.')
            if server['location'].replace(' ', '').lower() != os.environ.get('CG_POSTGRES_LOCATION', 'eastus'):
                raise ValueError('Existing PostgreSQL server is in another region; relocation requires a migration.')
    parameters = {'appName': name, 'tenantId': TENANT,
                  'postgresLocation': os.environ.get('CG_POSTGRES_LOCATION', 'eastus'),
                  'databasePassword': os.environ['CG_DATABASE_PASSWORD'],
                  'authClientId': os.environ['CG_AUTH_CLIENT_ID'],
                  'authClientSecret': os.environ['CG_AUTH_CLIENT_SECRET']}
    parameter_file = TEMPLATE.with_name('changeguard-postgres-parameters.json')
    with os.fdopen(os.open(parameter_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as output:
        json.dump({'parameters': {k: {'value': v} for k, v in parameters.items()}}, output)
    common = ['--resource-group', GROUP, '--template-file', str(TEMPLATE),
              '--parameters', '@' + str(parameter_file), '--mode', 'Incremental']
    try:
        az('deployment', 'group', 'validate', *common)
        preview = az('deployment', 'group', 'what-if', '--no-pretty-print', *common)
        # Log only resource IDs and change types, never secure parameter values.
        print(json.dumps([{'resourceId': c['resourceId'], 'changeType': c['changeType']}
                          for c in preview['changes']], indent=2), flush=True)
        az('deployment', 'group', 'create', '--name', 'changeguard-postgres-infrastructure', *common)
    finally:
        parameter_file.unlink(missing_ok=True)
    plan = az('appservice', 'plan', 'show', '--resource-group', GROUP, '--name', name + '-free')
    database = az('postgres', 'flexible-server', 'show', '--resource-group', GROUP, '--name', name + '-pg')
    if plan['sku']['name'] != 'F1' or database['sku']['name'] != 'Standard_B1ms' or postgres_storage_gb(database) != 32 or database['storage']['autoGrow'] != 'Disabled':
        raise ValueError('Post-deployment cost verification failed. Inspect the resources immediately.')
    app = az('webapp', 'show', '--resource-group', GROUP, '--name', name)
    addresses = sorted({str(ipaddress.IPv4Address(ip)) for ip in app['outboundIpAddresses'].split(',')})
    if not addresses or '0.0.0.0' in addresses:
        raise ValueError('App outbound addresses unavailable; refusing broad firewall access.')
    desired = {'app-outbound-' + ip.replace('.', '-'): ip for ip in addresses}
    existing_rules = az('postgres', 'flexible-server', 'firewall-rule', 'list', '--resource-group', GROUP, '--server-name', name + '-pg')
    existing = {rule['name']: rule for rule in existing_rules}
    for rule, ip in desired.items():
        current = existing.get(rule, {})
        if current.get('startIpAddress') == ip and current.get('endIpAddress') == ip:
            continue
        print(f'Updating PostgreSQL firewall rule {rule}', flush=True)
        az('postgres', 'flexible-server', 'firewall-rule', 'create', '--resource-group', GROUP,
           '--server-name', name + '-pg', '--name', rule, '--start-ip-address', ip, '--end-ip-address', ip)
    for rule in existing_rules:
        if rule['name'].startswith('app-outbound-') and rule['name'] not in desired:
            az('postgres', 'flexible-server', 'firewall-rule', 'delete', '--resource-group', GROUP,
               '--server-name', name + '-pg', '--name', rule['name'], '--yes')
    print('F1 web and paid B1ms PostgreSQL provisioned. App remains stopped until package delivery.')



if __name__ == '__main__':
    try:
        {'inputs': inputs, 'check': check, 'provision': provision}[sys.argv[1]]()
    except (RuntimeError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
