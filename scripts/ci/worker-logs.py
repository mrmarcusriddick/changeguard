"""Read Kudu container logs without waiting for the unhealthy main site."""
import json
import subprocess
import urllib.parse
import urllib.request


def capture(name):
    # The CLI log-tail command pings the main site before contacting Kudu.
    # A failed startup can consume its entire timeout there. Read Kudu directly.
    result = subprocess.run(['az', 'account', 'get-access-token', '--resource',
                             'https://management.azure.com/', '--query', 'accessToken', '-o', 'tsv'],
                            capture_output=True, text=True, check=True, timeout=15)
    token = result.stdout.strip()
    host = name + '.scm.azurewebsites.net'
    base = 'https://' + host

    def read(url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != host or parsed.query:
            raise ValueError('Unexpected container log URL')
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
        with urllib.request.urlopen(request, timeout=8) as response:
            return response.read(1024 * 1024).decode('utf-8', errors='replace')

    entries = json.loads(read(base + '/api/logs/docker'))
    for entry in sorted(entries, key=lambda item: item.get('lastChanged', ''), reverse=True)[:3]:
        url = entry.get('href', '')
        if not urllib.parse.urlsplit(url).path.startswith('/api/'):
            continue
        print('Container log:', entry.get('name', 'unnamed'), flush=True)
        for line in read(url).splitlines()[-80:]:
            if any(key in line.lower() for key in ('password', 'secret', 'authorization:', 'access_token')):
                print('[credential-related log line omitted]', flush=True)
            else:
                print(line.replace(token, '[redacted]'), flush=True)


if __name__ == '__main__':
    import os
    capture(os.environ['CG_APP_NAME'])
