"""Real inventory/journal integration over public in-memory read transports.

No native/authentication/network call is permitted. The real OwnerReads,
inventory/envelope/finish, paged exact Counter and O_EXCL Journal are exercised;
only their read transport is replaced, never the semantic guards.
"""
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_backup_policy as scope
import p8_lifecycle_eligibility as eligibility
import p8_lifecycle_owner23 as entry
import p8_oci_readonly as audit
import resource_audit
import security_session
from p6_audit_log import Journal
from p8_backup_iam_owner import OwnerReads
from test_object_storage_exact import API
from test_resource_audit import DOMAINS, FixtureClient, PROFILE

QUOTA = 'ocid1.quota.oc1..controlledfixture01'


class ExactStorageFixture(API):
    def __init__(self, names):
        super().__init__(current=[], versions=[])
        self.names = names
        self.config['compartment_id'] = scope.COMPARTMENT

    def read(self, operation, namespace, **selectors):
        if operation == 'list_buckets':
            self.calls.append((operation, selectors))
            return ([{'name': name, 'compartment_id': scope.COMPARTMENT}
                     for name in self.names]
                    if selectors['compartment_id'] == scope.COMPARTMENT else []), {}
        if operation == 'get_bucket':
            self.calls.append((operation, selectors))
            return self.config | {'name': selectors['bucket_name']}, {}
        return super().read(operation, namespace, **selectors)


class FullInventoryIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        temporary = self.stack.enter_context(tempfile.TemporaryDirectory(prefix='ir35-public-inventory-'))
        self.journal = Journal(Path(temporary) / 'write-once')
        self.names = [scope.BUCKET]
        self.transport_calls = []
        self.native = self.stack.enter_context(patch('subprocess.run', side_effect=AssertionError('Native call forbidden')))
        self.auth = self.stack.enter_context(patch.object(security_session, 'ensure_session',
                                                        side_effect=AssertionError('Private authentication forbidden')))
        self.stack.enter_context(patch('socket.create_connection', side_effect=AssertionError('Network forbidden')))
        self.stack.enter_context(patch('builtins.print'))
        self.clock_override = None

        def bucket_metadata():
            return {'name': scope.BUCKET, 'compartment-id': scope.COMPARTMENT,
                    'storage-tier': 'Standard', 'public-access-type': 'NoPublicAccess',
                    'versioning': 'Disabled', 'auto-tiering': 'Disabled',
                    'is-read-only': False, 'replication-enabled': False, 'kms-key-id': None}

        self.fixture = FixtureClient({
            'accountTenancy': {'id': PROFILE['tenancy'], 'name': 'Ir35careers'},
            'accountUser': {'id': PROFILE['user'], 'lifecycle-state': 'ACTIVE'},
            'accountRegions': [{'region-name': scope.REGION, 'is-home-region': True, 'status': 'READY'}],
            'accountSubscriptions': [{'lifecycle-state': 'ACTIVE', 'payment-model': 'FREE_TRIAL'}],
            'compartments': [{'id': scope.COMPARTMENT, 'lifecycle-state': 'ACTIVE'}],
            'instances': lambda values: [{'lifecycle-state': 'RUNNING', 'shape': 'VM.Standard.A1.Flex',
                'availability-domain': DOMAINS[0], 'shape-config': {'ocpus': 2, 'memory-in-gbs': 12}}]
                if values['compartment'] == scope.COMPARTMENT else [],
            'volumes': lambda values: [{'lifecycle-state': 'AVAILABLE', 'size-in-gbs': 100}]
                if values['compartment'] == scope.COMPARTMENT else [],
            'bootVolumes': lambda values: [{'lifecycle-state': 'AVAILABLE', 'size-in-gbs': 50}]
                if values['compartment'] == scope.COMPARTMENT and values['ad'] == DOMAINS[0] else [],
            'buckets': lambda values: [{'name': name} for name in self.names]
                if values['compartment'] == scope.COMPARTMENT else [],
            'bucket': lambda _values: bucket_metadata(),
            'quotas': lambda values: [{'id': QUOTA, 'name': 'ir35-always-free-cap', 'lifecycle-state': 'ACTIVE'}]
                if values['compartment'] == PROFILE['tenancy'] else [],
            'quotaDetails': {'id': QUOTA, 'compartment-id': PROFILE['tenancy'],
                             'lifecycle-state': 'ACTIVE', 'statements': audit.quota_statements()},
            'shapes': [{'shape': 'VM.Standard.A1.Flex', 'billing-type': 'LIMITED_FREE'}],
        })

        def transport(client, operation, **selectors):
            # Exercise the real fixed read-operation selector builders too.
            arguments = client.arguments(operation, **selectors)
            self.assertFalse(any(word in arguments for word in ('create', 'update', 'delete', 'put', 'launch')))
            self.transport_calls.append((operation, selectors))
            return self.fixture.read(operation, **selectors)

        self.stack.enter_context(patch.object(resource_audit.ReadOnlyOci, 'read', new=transport))
        self.measurements = []

    def measure(self, child):
        reads = OwnerReads(PROFILE, child)
        storage = ExactStorageFixture(self.names)
        proof = audit.execute(reads, child, storage)
        body = child.path('inventory.json').read_bytes()
        inventory = json.loads(body)
        self.measurements.append((child, body, reads, storage))
        bucket = entry.exact_bucket_safety(reads, inventory)
        account = resource_audit.session_account_audit(reads)
        child.put('bucket-safety.json', bucket)
        return {'inventory': inventory, 'inventorySHA256': hashlib.sha256(body).hexdigest(),
                'account': account, 'bucket': bucket, 'freeInventory': proof}

    def guard(self):
        return eligibility.FreshEligibility(self.journal, self.measure,
            clock=lambda: self.clock_override or datetime.now(timezone.utc))

    def test_full_real_measurement_is_bound_to_exclusive_artifacts_before_each_create(self):
        guard = self.guard()
        resources = [scope.DYNAMIC_GROUP, scope.POLICY_NAME,
                     'ir35-backup-lifecycle-service', 'ir35-backups-lifecycle']
        for number, name in enumerate(resources, 1):
            previous_reads = len(self.transport_calls)
            guard(name, exact_storage=name == 'ir35-backups-lifecycle')
            child, body, reads, storage = self.measurements[-1]
            self.assertEqual(child.prefix, f'eligibility-{number:03d}-')
            self.assertEqual(guard.receipt['inventorySHA256'], hashlib.sha256(body).hexdigest())
            inventory = json.loads(body)
            self.assertEqual(guard.receipt['checkedAt'], inventory['checkedAt'])
            self.assertEqual(inventory['usage']['liveVolumeGB'], '150')
            self.assertEqual(inventory['objectStorage']['exactBytes'], 0)
            self.assertEqual(inventory['objectStorage']['stableCompletePasses'], 2)
            self.assertEqual(inventory['objectStorage']['bucketListingStable'], True)
            self.assertEqual(reads.buckets, {scope.BUCKET})
            self.assertGreater(len(self.transport_calls), previous_reads)
            self.assertEqual(sum(op == 'list_buckets' for op, _ in storage.calls), 4)
            self.assertIn('quotaDetails', [op for op, _ in self.transport_calls[previous_reads:]])
            self.assertIn('shapes', [op for op, _ in self.transport_calls[previous_reads:]])
            self.journal.verify()
        self.assertEqual(guard.measurements, 4)
        self.native.assert_not_called()
        self.auth.assert_not_called()

    def test_real_inventory_timestamp_cannot_be_renewed_or_file_overwritten(self):
        guard = self.guard()
        guard(scope.DYNAMIC_GROUP)
        child, original, _reads, _storage = self.measurements[0]
        self.clock_override = datetime.fromisoformat(guard.receipt['checkedAt']) + timedelta(seconds=301)
        with self.assertRaisesRegex(eligibility.EligibilityError, 'FreshFiveMinute'):
            guard.assert_fresh(scope.DYNAMIC_GROUP)
        self.assertEqual(child.path('inventory.json').read_bytes(), original)
        with self.assertRaises(eligibility.EligibilityError):
            child.put('inventory.json', {'checkedAt': self.clock_override.isoformat()})
        self.assertEqual(child.path('inventory.json').read_bytes(), original)

    def test_full_casefold_collision_inventory_stops_without_auth_or_create(self):
        self.names.append('IR35-BACKUPS')
        guard = self.guard()
        with self.assertRaisesRegex(eligibility.EligibilityError, 'UniqueExactBackupBucketScopeRequired'):
            guard(scope.DYNAMIC_GROUP)
        self.assertIsNone(guard.receipt)
        self.assertEqual(json.loads((self.journal.root / 'eligibility-001-failure.json').read_bytes())['status'], 'FAIL')
        self.native.assert_not_called()
        self.auth.assert_not_called()

    def test_independent_inventory_sets_and_metadata_compartment_must_match(self):
        child = eligibility.PrefixedJournal(self.journal, 1)
        observed = self.measure(child)
        reads = self.measurements[-1][2]
        reads.buckets.add('unlisted-other-bucket')
        with self.assertRaisesRegex(entry.OwnerRunError, 'IndependentCompleteBucketInventoriesMustMatch'):
            entry.exact_bucket_safety(reads, observed['inventory'])
        reads.buckets.remove('unlisted-other-bucket')
        original = self.fixture.overrides['bucket']
        self.fixture.overrides['bucket'] = lambda values: original(values) | {'compartment-id': PROFILE['tenancy']}
        with self.assertRaisesRegex(scope.BackupScopeError, 'ExplicitPrivateStandardVersionOffWritableBucketRequired'):
            entry.exact_bucket_safety(reads, observed['inventory'])

    def test_missing_partial_duplicate_and_untrusted_bucket_names_fail_closed(self):
        for rows, count in ((None, 1), ([], 0), ([{'bucket': scope.BUCKET}], 2),
                            ([{'bucket': scope.BUCKET}, {'bucket': scope.BUCKET}], 2),
                            ([{'bucket': scope.BUCKET}, {'bucket': 'IR35-BACKUPS'}], 2),
                            ([{'bucket': 'private/path'}], 1)):
            with self.subTest(rows=rows, count=count), self.assertRaises(eligibility.EligibilityError):
                eligibility.complete_bucket_names({'objectStorage': {'bucketReports': rows, 'buckets': count}})


if __name__ == '__main__':
    unittest.main()
