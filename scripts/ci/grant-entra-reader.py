"""Run interactively as a tenant admin in Azure Cloud Shell; never used by CI."""
import json
import subprocess
import sys

TENANT = 'a72c5ca4-2803-4603-b2ed-1d4e1a6db4f2'
SUBSCRIPTION = 'a2e23015-1a59-4109-9126-cd464798993f'

def az(*args):
    return json.loads(subprocess.check_output(['az', *args, '--output', 'json'], text=True))

def main():
    account = az('account', 'show')
    if account['tenantId'] != TENANT or account['id'] != SUBSCRIPTION:
        sys.exit('Select the ChangeGuard tenant and subscription before running this script.')
    identity = az('webapp', 'identity', 'show', '--resource-group', 'changeguard-free', '--name', 'changeguard-mr-free')
    principal = identity.get('principalId')
    if not principal or identity.get('tenantId') != TENANT:
        sys.exit('The target app needs its system-assigned managed identity in the configured tenant.')
    graph = az('ad', 'sp', 'show', '--id', '00000003-0000-0000-c000-000000000000')
    role = next(r for r in graph['appRoles'] if r['value'] == 'Policy.Read.All' and r['isEnabled'] and 'Application' in r['allowedMemberTypes'])
    url = f'https://graph.microsoft.com/v1.0/servicePrincipals/{principal}/appRoleAssignments'
    existing = az('rest', '--method', 'GET', '--url', url)
    # Fail closed on pagination rather than assume a role is absent.
    while True:
        if any(r['resourceId'] == graph['id'] and r['appRoleId'] == role['id'] for r in existing['value']):
            print('Policy.Read.All is already granted to the app managed identity.')
            return
        next_url = existing.get('@odata.nextLink')
        if not next_url:
            break
        if not next_url.startswith(url + '?'):
            sys.exit('Unexpected Graph pagination URL.')
        existing = az('rest', '--method', 'GET', '--url', next_url)
    print(f'Target: changeguard-mr-free managed identity {principal}; tenant {TENANT}')
    if '--apply' not in sys.argv:
        print('Preview only. Run again with --apply to grant Microsoft Graph Policy.Read.All.')
        return
    body = json.dumps({'principalId': principal, 'resourceId': graph['id'], 'appRoleId': role['id']})
    az('rest', '--method', 'POST', '--url', url, '--headers', 'Content-Type=application/json', '--body', body)
    print('Granted Policy.Read.All. Permission propagation can be delayed. Open /entra and capture a baseline.')

if __name__ == '__main__':
    main()
