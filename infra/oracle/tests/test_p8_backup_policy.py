from datetime import datetime, timedelta, timezone
import inspect
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_backup_policy as policy

NOW = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)


def budget():
    return {'bucket_bytes': 100, 'tenancy_standard_bytes': 200, 'tenancy_all_tier_bytes': 300,
            'new_ciphertext_bytes': 100, 'monthly_requests_so_far': 10, 'planned_requests': 20,
            'exact_inventory': True, 'exact_request_count': True, 'account_state': 'FREE_TRIAL',
            'checked_at': NOW, 'now': NOW}


def lifecycle(**change):
    return policy.lifecycle_readiness(**({'service_principal': 'objectstorage-uk-london-1',
        'compartment_id': policy.COMPARTMENT, 'bucket_name': policy.BUCKET,
        'observed_permissions': sorted(policy.LIFECYCLE_MINIMUM),
        'authenticated_scope_verified': True, 'new_grant_required': False} | change))


class BackupPolicyTests(unittest.TestCase):
    def test_exact_one_instance_matching_rule_no_tags_or_compartment_wildcard(self):
        self.assertEqual(policy.matching_rule(), "instance.id = '" + policy.INSTANCE + "'")
        for value in ('*', policy.COMPARTMENT, policy.INSTANCE + "' OR true", policy.INSTANCE.upper()):
            with self.assertRaises(policy.BackupScopeError): policy.matching_rule(instance_id=value)

    def test_exact_bucket_child_scope_three_permissions_only_no_delete_overwrite_or_management(self):
        value = policy.policy_statement()
        self.assertEqual(value.count('Allow '), 1)
        self.assertIn('dynamic-group ' + policy.DYNAMIC_GROUP, value)
        self.assertIn('in compartment id ' + policy.COMPARTMENT, value)
        self.assertIn("target.bucket.name='ir35-backups'", value)
        self.assertEqual(value.count('request.permission='), 3)
        for permission in policy.PERMISSIONS: self.assertIn("request.permission='" + permission + "'", value)
        for broader in ('OBJECT_DELETE', 'OBJECT_OVERWRITE', 'BUCKET_', 'object-family', ' in tenancy', 'any-user', '*'):
            self.assertNotIn(broader, value)
        for changes in ({'bucket_name': 'IR35-BACKUPS'}, {'bucket_name': '*'}, {'compartment_id': 'root'}, {'group_name': 'all-workers'}):
            with self.assertRaises(policy.BackupScopeError): policy.policy_statement(**changes)

    def test_readback_requires_exact_active_binding_and_no_additional_statement(self):
        group = {'name': policy.DYNAMIC_GROUP, 'matching-rule': policy.matching_rule(), 'lifecycle-state': 'ACTIVE'}
        row = {'name': policy.POLICY_NAME, 'compartment-id': policy.COMPARTMENT, 'lifecycle-state': 'ACTIVE',
               'statements': [policy.policy_statement()]}
        self.assertEqual(policy.validate_group(group)['status'], 'PASS')
        self.assertFalse(policy.validate_policy(row)['effectiveIamProven'])
        for changes in ({'matching-rule': "instance.compartment.id = '" + policy.COMPARTMENT + "'"}, {'lifecycle-state': 'DELETED'}):
            with self.assertRaises(policy.BackupScopeError): policy.validate_group(group | changes)
        for changes in ({'statements': row['statements'] + ['Allow any-user to manage all-resources in tenancy']},
                        {'compartment-id': 'root'}, {'lifecycle-state': 'INACTIVE'}):
            with self.assertRaises(policy.BackupScopeError): policy.validate_policy(row | changes)

    def test_bucket_private_standard_explicit_flags_and_casefold_collisions(self):
        row = {'name': policy.BUCKET, 'compartment-id': policy.COMPARTMENT, 'storage-tier': 'Standard',
               'public-access-type': 'NoPublicAccess', 'versioning': 'Disabled', 'auto-tiering': 'Disabled', 'is-read-only': False}
        self.assertEqual(policy.validate_bucket(row, [policy.BUCKET])['status'], 'PASS')
        for names in ([], [policy.BUCKET, 'IR35-BACKUPS'], ['IR35-BACKUPS'], [None]):
            with self.assertRaises(policy.BackupScopeError): policy.validate_bucket(row, names)
        for key, bad in (('storage-tier', 'Archive'), ('public-access-type', 'ObjectRead'), ('versioning', 'Enabled'),
                         ('auto-tiering', None), ('is-read-only', True)):
            with self.assertRaises(policy.BackupScopeError): policy.validate_bucket(row | {key: bad}, [policy.BUCKET])

    def test_exact_overlap_guard_never_subtracts_expected_lifecycle_deletions(self):
        result = policy.usage_budget(**budget())
        self.assertEqual(result['uploadOverlapBytes'], 200)
        self.assertEqual(result['expectedLifecycleDeletionsSubtracted'], 0)
        self.assertFalse(result['billingZeroProven'])
        with self.assertRaisesRegex(policy.BackupScopeError, 'EightGb'):
            policy.usage_budget(**(budget() | {'bucket_bytes': policy.OWNER_CAP, 'tenancy_standard_bytes': policy.OWNER_CAP,
                                             'tenancy_all_tier_bytes': policy.OWNER_CAP, 'new_ciphertext_bytes': 1}))

    def test_trial_standard_tenancy_usage_and_combined_eighty_percent_are_independent(self):
        with self.assertRaisesRegex(policy.BackupScopeError, 'AlwaysFreeStorageEnvelope'):
            policy.usage_budget(**(budget() | {'tenancy_standard_bytes': policy.TRIAL_STANDARD_CAP,
                                              'tenancy_all_tier_bytes': policy.TRIAL_STANDARD_CAP, 'new_ciphertext_bytes': 1}))
        for total in (16_000_000_001, 16_000_000_000):
            with self.assertRaisesRegex(policy.BackupScopeError, 'EightyPercent'):
                policy.usage_budget(**(budget() | {'account_state': 'ALWAYS_FREE', 'tenancy_all_tier_bytes': total,
                                                  'new_ciphertext_bytes': 1}))

    def test_missing_approximate_or_bool_counts_stale_times_paid_state_and_request_overage_fail(self):
        for changes in ({'exact_inventory': False}, {'exact_request_count': False}, {'bucket_bytes': True},
                        {'new_ciphertext_bytes': 1.2}, {'monthly_requests_so_far': 50_000, 'planned_requests': 1},
                        {'checked_at': NOW - timedelta(minutes=5, seconds=1)}, {'checked_at': NOW + timedelta(seconds=1)},
                        {'account_state': 'PAY_AS_YOU_GO'}, {'tenancy_standard_bytes': 50}):
            with self.assertRaises(policy.BackupScopeError): policy.usage_budget(**(budget() | changes))

    def test_write_once_single_part_instance_principal_uses_only_owned_age_names(self):
        result = policy.single_part_upload(namespace='fixturepublicns', generation=NOW, part='database')
        self.assertEqual(result['authentication'], 'instance_principal')
        self.assertFalse(result['multipartAllowed']); self.assertFalse(result['cliStdinAllowed']); self.assertFalse(result['overwriteAllowed'])
        self.assertEqual(result['request']['if_none_match'], '*')
        self.assertEqual(result['request']['storage_tier'], 'Standard')
        self.assertEqual(result['request']['object_name'], 'ir35-backups-v1/daily/20261028T120000Z/database.age')
        sunday = NOW + timedelta(days=4)
        self.assertEqual(policy.generation_object(sunday, 'storage'), 'ir35-backups-v1/weekly/20261101T120000Z/storage.age')
        for part in ('raw.sql', '../database', 'identity', 'caddy', 'database.age', {}, []):
            with self.assertRaises(policy.BackupScopeError): policy.single_part_upload(namespace='fixturepublicns', generation=NOW, part=part)

    def test_no_vm_management_multipart_overwrite_delete_or_copy_fallback(self):
        for allowed in ('PutNewObject', 'ListObjects', 'HeadObject', 'GetObject'): self.assertTrue(policy.operation_allowed(allowed))
        for forbidden in ('DeleteObject', 'ListBuckets', 'GetBucket', 'PutObjectLifecyclePolicy', 'CreateMultipartUpload',
                          'UploadPart', 'CommitMultipartUpload', 'AbortMultipartUpload', 'OverwriteObject', 'CreateCopyRequest', 'unknown'):
            self.assertFalse(policy.operation_allowed(forbidden))

    def test_lifecycle_missing_service_grant_stops_instead_of_expanding_vm_or_iam(self):
        result = lifecycle(observed_permissions=list(policy.PERMISSIONS), new_grant_required=True)
        self.assertEqual(result['status'], 'BLOCKED_OWNER_DECISION_REQUIRED')
        self.assertIn('OBJECT_DELETE', result['missingPermissions'])
        self.assertEqual(result['iamWrites'], 0); self.assertFalse(result['servicePolicyCreated']); self.assertFalse(result['vmDeleteAllowed'])
        with self.assertRaisesRegex(policy.BackupScopeError, 'Stop_NoBroaderGrant'): policy.lifecycle_rules(result)

    def test_lifecycle_only_owned_prefix_delete_no_archive_tiering_wildcards_or_vm_execution(self):
        rules = policy.lifecycle_rules(lifecycle())
        self.assertEqual(len(rules), 2)
        self.assertEqual([row['time_amount'] for row in rules], [7, 28])
        for rule, lane in zip(rules, ('daily', 'weekly')):
            self.assertEqual(rule['action'], 'DELETE'); self.assertEqual(rule['target'], 'objects')
            self.assertEqual(rule['time_unit'], 'DAYS')
            self.assertEqual(rule['object_name_filter'], {'inclusion_prefixes': ['ir35-backups-v1/' + lane + '/']})
        with self.assertRaises(policy.BackupScopeError): lifecycle(authenticated_scope_verified=False)
        with self.assertRaises(policy.BackupScopeError): lifecycle(service_principal='objectstorage-other-region')
        for permissions in ([{}], ['OBJECT_DELETE', 'OBJECT_DELETE'], ['secret-value\nOBJECT_DELETE']):
            with self.assertRaises(policy.BackupScopeError): lifecycle(observed_permissions=permissions)

    def test_pure_builders_do_not_read_private_state_or_touch_network(self):
        with patch('builtins.open', side_effect=AssertionError('filesystem touched')), \
             patch('socket.socket', side_effect=AssertionError('network touched')), \
             patch('subprocess.run', side_effect=AssertionError('process touched')):
            policy.matching_rule(); policy.policy_statement(); policy.usage_budget(**budget())
            policy.single_part_upload(namespace='fixturepublicns', generation=NOW, part='queue')
            policy.lifecycle_rules(lifecycle())
        source = inspect.getsource(policy)
        for forbidden in ('import oci', 'import subprocess', 'import os', 'requests.', 'urllib.', 'print(', 'open(', 'eval('):
            self.assertNotIn(forbidden, source)
        self.assertNotIn('fixturepublicns', json.dumps(policy.lifecycle_rules(lifecycle())))
