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
            {'type': 'Microsoft.Web/serverfarms', 'sku': {'name': 'B1', 'tier': 'Basic', 'capacity': 1}},
            {'type': 'Microsoft.DBforPostgreSQL/flexibleServers',
             'sku': {'name': 'Standard_B1ms', 'tier': 'Burstable'},
             'properties': {'storage': {'storageSizeGB': 32, 'autoGrow': 'Disabled'},
                            'backup': {'backupRetentionDays': 7, 'geoRedundantBackup': 'Disabled'},
                            'highAvailability': {'mode': 'Disabled'}}}]}

    def test_firewall_reconciliation_preserves_unrelated_rules(self):
        existing = [
            {'name': 'app-outbound-20-1-1-1', 'startIpAddress': '20.1.1.1', 'endIpAddress': '20.1.1.1'},
            {'name': 'app-outbound-20-1-1-2', 'startIpAddress': '20.1.1.2', 'endIpAddress': '20.1.1.9'},
            {'name': 'app-outbound-20-1-1-3', 'startIpAddress': '20.1.1.3', 'endIpAddress': '20.1.1.3'},
            {'name': 'administrator-rule', 'startIpAddress': '20.1.1.4', 'endIpAddress': '20.1.1.4'},
        ]
        with patch.object(infra, 'az', return_value=existing) as az:
            infra.reconcile_firewall('changeguard-mr-free', '20.1.1.1,20.1.1.2')
        calls = [call.args for call in az.call_args_list]
        writes = [call for call in calls if call[3] in ('create', 'delete')]
        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[0][writes[0].index('--name') + 1], 'app-outbound-20-1-1-2')
        self.assertEqual(writes[1][writes[1].index('--name') + 1], 'app-outbound-20-1-1-3')

    def test_unchanged_firewall_has_no_writes(self):
        existing = [{'name': 'app-outbound-20-1-1-1', 'startIpAddress': '20.1.1.1', 'endIpAddress': '20.1.1.1'}]
        with patch.object(infra, 'az', return_value=existing) as az:
            infra.reconcile_firewall('changeguard-mr-free', '20.1.1.1')
        self.assertEqual(az.call_count, 1)

    def test_invalid_firewall_addresses_cannot_write(self):
        for address in ('', '0.0.0.0', 'invalid'):
            with patch.object(infra, 'az') as az, self.assertRaises(ValueError):
                infra.reconcile_firewall('changeguard-mr-free', address)
            az.assert_not_called()

    def test_storage_response_casing(self):
        for key in ('storageSizeGb', 'storageSizeGB'):
            self.assertEqual(infra.postgres_storage_gb({'storage': {key: 32}}), 32)
            self.assertEqual(infra.postgres_storage_gb({'storage': {key: 64}}), 64)

    def test_storage_response_fails_closed(self):
        for storage in ({}, {'storageSizeGb': None}, {'storageSizeGb': '32'},
                        {'storageSizeGb': 32, 'storageSizeGB': 64}):
            with self.subTest(storage=storage), self.assertRaises(ValueError):
                infra.postgres_storage_gb({'storage': storage})

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

    def test_reject_unauthorized_web_and_extra_resources(self):
        doc = copy.deepcopy(self.doc)
        doc['resources'][0]['sku']['name'] = 'B2'
        with self.assertRaises(ValueError):
            infra.validate_template(doc)
        self.doc['resources'].append({'type': 'Microsoft.Sql/servers'})
        with self.assertRaises(ValueError):
            infra.validate_template(self.doc)

    def test_reject_f1_downgrade_and_extra_instances(self):
        for sku in ({'name': 'F1', 'tier': 'Free', 'capacity': 1},
                    {'name': 'B1', 'tier': 'Basic', 'capacity': 2}):
            doc = copy.deepcopy(self.doc)
            doc['resources'][0]['sku'] = sku
            with self.subTest(sku=sku), self.assertRaises(ValueError):
                infra.validate_template(doc)

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
