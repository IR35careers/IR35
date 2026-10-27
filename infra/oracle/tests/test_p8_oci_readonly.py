import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_oci_readonly as audit
from p6_audit_log import Journal
from key_ceremony import KeySafetyError
from test_object_storage_exact import API
from p6_audit_log import AuditFailure


def report():
    return {'usage': {'instances': 1, 'a1Ocpus': '2', 'a1MemoryGB': '12', 'liveVolumeGB': '150',
        'bootVolumes': 1, 'blockVolumes': 1, 'volumeBackups': 0},
        'objectStorage': {'exactBytesProven': True, 'standardOnly': True, 'exactBytes': 0, 'overEightyPercent': False},
        'costReport': {'amounts': {}}}


class ReadonlyTests(unittest.TestCase):
    def test_summary_without_statements_requires_get_and_actual_parity(self):
        with tempfile.TemporaryDirectory() as directory:
            client = audit.RecordedReads({'tenancy': 'ocid1.tenancy.oc1..controlledfixture01'}, Journal(Path(directory) / 'one'))
            identifier = 'ocid1.quota.oc1..controlledfixture01'
            snapshot = report() | {'availabilityDomains': [{'domain': 'mock:UK-LONDON-1-AD-1'}]}
            def read(operation, **selectors):
                if operation == 'quotas': return [{'name': 'ir35-always-free-cap', 'id': identifier, 'lifecycle-state': 'ACTIVE'}]
                if operation == 'quotaDetails': return {'id': identifier, 'compartment-id': client.profile['tenancy'],
                    'lifecycle-state': 'ACTIVE', 'statements': audit.quota_statements()}
                if operation == 'instances': return [{'availability-domain': 'mock:UK-LONDON-1-AD-1', 'lifecycle-state': 'RUNNING'}] if selectors['compartment'] == client.profile['tenancy'] else []
                if operation == 'shapes': return [{'shape': 'VM.Standard.A1.Flex', 'billing-type': 'LIMITED_FREE'}]
                raise AssertionError('Unexpected read')
            with patch.object(client, 'read', side_effect=read) as observed:
                self.assertEqual(audit.finish(client, client.journal, snapshot)['status'], 'PASS')
                self.assertIn(unittest.mock.call('quotaDetails', quota=identifier), observed.call_args_list)

    def test_quota_get_is_fixed_and_only_for_observed_id(self):
        with tempfile.TemporaryDirectory() as directory:
            client = audit.RecordedReads({'tenancy': 'ocid1.tenancy.oc1..controlledfixture01'}, Journal(Path(directory) / 'one'))
            identifier = 'ocid1.quota.oc1..controlledfixture01'
            with self.assertRaises(KeySafetyError): client.arguments('quotaDetails', quota=identifier)
            client.quota_ids.add(identifier)
            self.assertEqual(client.arguments('quotaDetails', quota=identifier), ['limits', 'quota', 'get', '--quota-id', identifier])
            with self.assertRaises(KeySafetyError): client.arguments('quotaDetails', quota=identifier, endpoint='private.invalid')

    def test_original_adapter_failure_precedes_storage_request_and_fixed_full_counter_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            old = Journal(Path(directory) / 'old'); api = API()
            counter = audit.Counter(api, record=lambda name, value: old.put('storage-' + name + '.json', value))
            with self.assertRaisesRegex(AuditFailure, 'ClosedOrUnsafeAuditArtifact'):
                counter.full_audit('fixture', ['fixture-child'])
            self.assertEqual(api.calls, [])
            fixed = Journal(Path(directory) / 'fixed')
            recorder = audit.storage_recorder(fixed)
            proof = audit.Counter(api, record=recorder).full_audit('fixture', ['fixture-child'])
            self.assertEqual(proof['exactBytes'], 10)
            self.assertEqual(proof['stableCompletePasses'], 2)
            with self.assertRaises(FileExistsError): recorder('00001-list_buckets-intent', {})
            self.assertNotIn('private-path-canary', ''.join(path.read_text() for path in fixed.root.iterdir()))

    def test_allocation_byte_and_cost_guards_fail_closed(self):
        self.assertTrue(audit.envelope(report()))
        for field, value in [('instances', 2), ('a1Ocpus', '3'), ('a1MemoryGB', '24'),
                             ('liveVolumeGB', '151'), ('volumeBackups', 6)]:
            row = report(); row['usage'][field] = value
            with self.assertRaises(KeySafetyError): audit.envelope(row)
        for value in (8_000_000_001, 16_000_000_001):
            row = report(); row['objectStorage']['exactBytes'] = value
            with self.assertRaises(KeySafetyError): audit.envelope(row)
        row = report(); row['costReport']['amounts'] = {'GBP': {'net': '-1', 'positive': '0.01'}}
        with self.assertRaises(KeySafetyError): audit.envelope(row)

    def test_every_read_is_journalled_and_raw_response_never_written(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(Path(directory) / 'one')
            client = audit.RecordedReads({'tenancy': 'ocid1.tenancy.oc1..controlledfixture01'}, journal)
            secret = 'private-test-sentinel-do-not-publish'
            with patch.object(audit.ReadOnlyOci, 'read', return_value={'private': secret}):
                self.assertEqual(client.read('accountTenancy'), {'private': secret})
            with patch.object(audit.ReadOnlyOci, 'read', side_effect=RuntimeError(secret)):
                with self.assertRaises(RuntimeError): client.read('accountUser')
            journal.seal({'status': 'FAIL'})
            contents = ''.join(path.read_text() for path in journal.root.iterdir())
            self.assertNotIn(secret, contents)
            self.assertEqual(json.loads((journal.root / 'oci-002-result.json').read_text())['status'], 'FAIL')
            with self.assertRaises(FileExistsError): Journal(journal.root)

    def test_command_surface_remains_read_only(self):
        client = audit.ReadOnlyOci({'tenancy': 'ocid1.tenancy.oc1..controlledfixture01'})
        for operation in ('create', 'update', 'delete', 'upload', 'raw-request'):
            with self.assertRaises(KeySafetyError): client.arguments(operation)
        self.assertIn('list', client.arguments('quotas'))


if __name__ == '__main__': unittest.main()
