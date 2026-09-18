"""Temporarily test a disabled, recreated B1 worker before package delivery."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shlex
import subprocess
import time
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('infra', 'scripts/ci/azure-infrastructure.py')
infra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(infra)
az = infra.az
name = os.environ['CG_APP_NAME']
account = az('account', 'show')
if account['id'] != infra.SUBSCRIPTION or account['tenantId'] != infra.TENANT:
    raise RuntimeError('Unexpected Azure account')
target = ['--resource-group', infra.GROUP, '--name', name]
app = az('webapp', 'show', *target)
if app.get('enabled') is not False:
    print('Worker probe skipped: only disabled, recreated apps may use the temporary startup command.')
    raise SystemExit(0)
plan = az('appservice', 'plan', 'show', '--ids', app['serverFarmId'])
if plan['sku']['name'] != 'B1' or plan['sku'].get('capacity') != 1:
    raise RuntimeError('Worker probe requires the authorized B1 plan')
config = az('webapp', 'config', 'show', *target)
previous = config.get('appCommandLine') or ''
# A newly recreated app has no mounted ZIP yet. Run the independent probe
# without package mounting, then restore the original setting before delivery.
package = az('webapp', 'config', 'appsettings', 'list', *target,
             '--query', "[?name=='WEBSITE_RUN_FROM_PACKAGE'].value | [0]")
nonce = secrets.token_hex(16)
source = Path('scripts/ci/probe-worker.mjs').read_text().replace('__NONCE__', nonce)
command = 'node --input-type=module -e ' + shlex.quote(source.strip())
if len(command) > 1024 or '\n' in command:
    raise RuntimeError('Diagnostic startup command must fit on one short line')
url = 'https://management.azure.com' + app['id'] + '?api-version=2024-11-01'
try:
    # Capture stdout/stderr before starting, while Kudu remains accessible.
    az('webapp', 'log', 'config', *target, '--docker-container-logging', 'filesystem')
    if package is not None:
        az('webapp', 'config', 'appsettings', 'delete', *target,
           '--setting-names', 'WEBSITE_RUN_FROM_PACKAGE')
    az('webapp', 'config', 'set', *target, '--startup-file', command)
    az('rest', '--method', 'patch', '--url', url, '--body', '{"properties":{"enabled":true}}')
    az('webapp', 'start', *target)
    deadline = time.monotonic() + 300
    diagnostic_at = time.monotonic() + 35
    diagnostic_taken = False
    result = None
    while time.monotonic() < deadline:
        if not diagnostic_taken and time.monotonic() >= diagnostic_at:
            diagnostic_taken = True
            for arguments in (
                ['webapp', 'show', *target, '--query', '{state:state,enabled:enabled,usageState:usageState}'],
                ['worker-container-logs'],
            ):
                try:
                    command_args = (['python3', 'scripts/ci/worker-logs.py'] if arguments == ['worker-container-logs']
                                    else ['az', *arguments, '--only-show-errors', '-o', 'json'])
                    diagnostic = subprocess.run(command_args,
                                                capture_output=True, text=True, timeout=45)
                    print(diagnostic.stdout or diagnostic.stderr, flush=True)
                except subprocess.TimeoutExpired as error:
                    # Log streaming is intentionally bounded; keep its partial output.
                    for output in (error.stdout, error.stderr):
                        if output:
                            print(output.decode('utf-8', errors='replace') if isinstance(output, bytes) else output, flush=True)
                    print('Bounded startup log capture finished', flush=True)
        try:
            try:
                response = urllib.request.urlopen('https://' + name + '.azurewebsites.net/api/health', timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            print('Worker probe HTTP status:', response.code, flush=True)
            with response:
                candidate = json.loads(response.read(8192))
            if candidate.get('probe') == nonce and candidate.get('done') is True:
                result = candidate
                break
        except (OSError, ValueError):
            pass
        time.sleep(5)
    if result is None:
        try:
            late = subprocess.run(['python3', 'scripts/ci/worker-logs.py'], capture_output=True, text=True, timeout=45)
            print(late.stdout or late.stderr, flush=True)
        except subprocess.TimeoutExpired as error:
            for output in (error.stdout, error.stderr):
                if output:
                    print(output.decode('utf-8', errors='replace') if isinstance(output, bytes) else output, flush=True)
        raise RuntimeError('Worker probe did not return a current result within 300 seconds')
    print('Application worker connectivity:', json.dumps({k: v for k, v in result.items() if k != 'probe'}), flush=True)
    if result.get('tcp') is not True:
        raise RuntimeError('PostgreSQL TCP/5432 is unreachable from the app worker; package delivery blocked')
finally:
    # Restore startup even when stopping fails. Never change auth or database rules.
    try:
        az('webapp', 'stop', *target)
    finally:
        try:
            az('webapp', 'config', 'set', *target, '--startup-file', previous)
        finally:
            try:
                if package is not None:
                    az('webapp', 'config', 'appsettings', 'set', *target,
                       '--settings', 'WEBSITE_RUN_FROM_PACKAGE=' + package)
            finally:
                az('rest', '--method', 'patch', '--url', url, '--body', '{"properties":{"enabled":false}}')
