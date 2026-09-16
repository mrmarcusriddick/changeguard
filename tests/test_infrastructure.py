import copy
import importlib.util
import json
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('infra', 'scripts/ci/azure-infrastructure.py')
infra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(infra)

class InfrastructureGuards(unittest.TestCase):
    def setUp(self):
        self.doc = {'resources': [
            {'type': 'Microsoft.Web/serverfarms', 'sku': {'name': 'F1', 'tier': 'Free', 'capacity': 1}},
            {'type': 'Microsoft.DBforPostgreSQL/flexibleServers',
             'sku': {'name': 'Standard_B1ms', 'tier': 'Burstable'},
             'properties': {'storage': {'storageSizeGB': 32, 'autoGrow': 'Disabled'},
                            'backup': {'backupRetentionDays': 7, 'geoRedundantBackup': 'Disabled'},
                            'highAvailability': {'mode': 'Disabled'}}}]}

    def test_authorized_configuration(self):
        infra.validate_template(self.doc)

    def test_reject_cost_increases(self):
        for path, value in [('sku', {'name': 'Standard_D2s_v3', 'tier': 'GeneralPurpose'}),
                            ('storage', {'storageSizeGB': 64, 'autoGrow': 'Disabled'}),
                            ('storage', {'storageSizeGB': 32, 'autoGrow': 'Enabled'}),
                            ('highAvailability', {'mode': 'ZoneRedundant'})]:
            doc = copy.deepcopy(self.doc)
            pg = doc['resources'][1]
            (pg if path == 'sku' else pg['properties'])[path] = value
            with self.subTest(path=path, value=value), self.assertRaises(ValueError):
                infra.validate_template(doc)

    def test_reject_paid_web_and_extra_resources(self):
        doc = copy.deepcopy(self.doc)
        doc['resources'][0]['sku']['name'] = 'B1'
        with self.assertRaises(ValueError):
            infra.validate_template(doc)
        self.doc['resources'].append({'type': 'Microsoft.Sql/servers'})
        with self.assertRaises(ValueError):
            infra.validate_template(self.doc)

    def test_invalid_json_stops_with_command_name(self):
        with patch.object(infra.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, 'Resource changes', '')):
            with self.assertRaisesRegex(RuntimeError, 'az deployment group what-if returned non-JSON'):
                infra.az('deployment', 'group', 'what-if', '--no-pretty-print')

    def test_cli_errors_are_not_swallowed(self):
        with patch.object(infra.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'ProvisioningDisabled')):
            with self.assertRaisesRegex(RuntimeError, 'ProvisioningDisabled'):
                infra.az('deployment', 'group', 'create')

if __name__ == '__main__':
    unittest.main()
