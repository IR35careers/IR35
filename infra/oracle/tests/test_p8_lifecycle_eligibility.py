import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_lifecycle_eligibility as eligibility
import p8_backup_policy as scope
import p8_lifecycle_owner31 as owner
from test_p8_lifecycle_owner31 import FakeApi, Journal, ROOT, BASE, immediate
from unittest.mock import patch

NOW = datetime(2026, 11, 23, 12, tzinfo=timezone.utc)


def observation(now):
    return {'inventory': {'checkedAt': now.isoformat(),
        'usage': {'instances': 1, 'a1Ocpus': '2', 'a1MemoryGB': '12', 'liveVolumeGB': '150',
                  'bootVolumes': 1, 'blockVolumes': 1, 'volumeBackups': 0},
        'objectStorage': {'exactBytesProven': True, 'standardOnly': True, 'exactBytes': 0,
                          'overEightyPercent': False}, 'costReport': {'amounts': {'GBP': {'positive': '0'}}}},
        'inventorySHA256': 'a' * 64,
        'account': {'homeRegion': scope.REGION, 'activeUserMatch': True,
                    'subscriptions': [{'paymentModel': 'FREE_TRIAL', 'state': 'ACTIVE'}]},
        'bucket': {'status': 'PASS', 'bucket': scope.BUCKET, 'storageTier': 'Standard',
                   'versioning': 'Disabled', 'autoTiering': 'Disabled',
                   'replicationEnabled': False, 'customerManagedKey': False},
        'freeInventory': {'status': 'PASS', 'readOnly': True, 'cloudWrites': 0, 'keyOrIAMChanges': 0}}


class FreshEligibilityTests(unittest.TestCase):
    def setUp(self):
        self.now = NOW
        self.journal = Journal()
        self.measured = []
        def measure(child):
            self.measured.append(child.prefix)
            child.put('inventory.json', {'checkedAt': self.now.isoformat()})
            return observation(self.now)
        self.measure = measure
        self.guard = eligibility.FreshEligibility(self.journal, measure, clock=lambda: self.now)
        self.print_fixture = patch('builtins.print')
        self.print_fixture.start()
        self.addCleanup(self.print_fixture.stop)

    def test_full_measurement_for_every_create_even_when_previous_is_fresh(self):
        self.guard(scope.DYNAMIC_GROUP)
        self.guard(scope.POLICY_NAME)
        self.assertEqual(self.measured, ['eligibility-001-', 'eligibility-002-'])
        self.assertIn('eligibility-001-inventory.json', self.journal.values)
        self.assertIn('eligibility-002-inventory.json', self.journal.values)
        self.guard.assert_fresh(scope.POLICY_NAME)
        with self.assertRaisesRegex(eligibility.EligibilityError, 'ExactCreateRequired'):
            self.guard.assert_fresh(scope.DYNAMIC_GROUP)

    def test_delayed_prior_iam_step_gets_new_inventory_not_a_new_timestamp(self):
        self.guard(scope.DYNAMIC_GROUP)
        original = copy.deepcopy(self.journal.values['eligibility-001-inventory.json'])
        self.now += timedelta(seconds=650)
        self.guard(scope.POLICY_NAME)
        self.assertEqual(self.journal.values['eligibility-001-inventory.json'], original)
        self.assertNotEqual(original, self.journal.values['eligibility-002-inventory.json'])
        self.assertEqual(len(self.measured), 2)

    def test_real_receipt_boundary_still_exactly_300_seconds(self):
        self.guard(scope.DYNAMIC_GROUP)
        self.now += timedelta(seconds=300)
        self.guard.assert_fresh(scope.DYNAMIC_GROUP)
        self.now += timedelta(microseconds=1)
        with self.assertRaisesRegex(eligibility.EligibilityError, 'FreshFiveMinute'):
            self.guard.assert_fresh(scope.DYNAMIC_GROUP)
        self.assertEqual(eligibility.MAX_AGE_SECONDS, 300)

    def test_slow_full_measurement_fails_without_refresh_loop_or_mutation(self):
        calls = []
        def stale(child):
            calls.append(child.prefix)
            return observation(self.now - timedelta(seconds=301))
        guard = eligibility.FreshEligibility(self.journal, stale, clock=lambda: self.now)
        with self.assertRaisesRegex(eligibility.EligibilityError, 'FreshFiveMinute'):
            guard(scope.DYNAMIC_GROUP)
        self.assertEqual(calls, ['eligibility-001-'])
        self.assertIsNone(guard.receipt)
        self.assertEqual(self.journal.values['eligibility-001-failure.json']['status'], 'FAIL')

    def test_future_naive_invalid_timestamps_fail_closed(self):
        for value in ((NOW + timedelta(seconds=1)).isoformat(), NOW.replace(tzinfo=None).isoformat(),
                      '', None, 'not-a-time'):
            with self.subTest(value=value), self.assertRaises(eligibility.EligibilityError):
                eligibility.age_seconds(value, NOW)

    def test_refresh_prefix_is_exclusive_and_bounded(self):
        child = eligibility.PrefixedJournal(self.journal, 1)
        child.put('inventory.json', {'status': 'PASS'})
        with self.assertRaises(eligibility.EligibilityError):
            child.put('inventory.json', {'status': 'replacement'})
        self.assertEqual(self.journal.values['eligibility-001-inventory.json'], {'status': 'PASS'})
        for number in (0, 5, True, '1'):
            with self.assertRaises(eligibility.EligibilityError):
                eligibility.PrefixedJournal(self.journal, number)

    def test_any_free_or_security_evidence_failure_denies_create(self):
        changes = [(('inventory', 'usage', 'a1Ocpus'), '3'),
                   (('inventory', 'objectStorage', 'exactBytes'), scope.OWNER_CAP + 1),
                   (('inventory', 'objectStorage', 'exactBytesProven'), False),
                   (('inventory', 'objectStorage', 'overEightyPercent'), True),
                   (('inventory', 'costReport', 'amounts', 'GBP', 'positive'), '0.01'),
                   (('account', 'subscriptions'), [{'paymentModel': 'PAYG', 'state': 'ACTIVE'}]),
                   (('bucket', 'replicationEnabled'), True),
                   (('freeInventory', 'status'), 'FAIL')]
        for path, value in changes:
            with self.subTest(path=path):
                bad = observation(self.now)
                node = bad
                for key in path[:-1]:
                    node = node[key]
                node[path[-1]] = value
                guard = eligibility.FreshEligibility(Journal(), lambda child: bad, clock=lambda: self.now)
                with self.assertRaises(eligibility.EligibilityError):
                    guard(scope.DYNAMIC_GROUP)
                self.assertIsNone(guard.receipt)

    def test_failure_after_first_create_keeps_exact_rollback_proof(self):
        api = FakeApi()
        root = patch.object(owner, 'ROOT_POLICY_SHA', owner.sha(BASE['statements']))
        with root:
            def second_stale(child):
                self.measured.append(child.prefix)
                return observation(self.now if len(self.measured) == 1 else self.now - timedelta(seconds=301))
            guard = eligibility.FreshEligibility(self.journal, second_stale, clock=lambda: self.now)
            run = owner.OwnerRun(api, self.journal, ROOT, guard, immediate)
            with self.assertRaisesRegex(eligibility.EligibilityError, 'FreshFiveMinute'):
                run.execute()
            self.assertEqual([name for name, _ in api.calls if name.startswith('create-')], ['create-group'])
            rollback = run.rollback()
            self.assertEqual(rollback['status'], 'PASS')
            self.assertEqual(rollback['createdResourcesRemoved'], 1)
            self.assertEqual(rollback['originalRootPolicySHA256'], owner.ROOT_POLICY_SHA)
            self.assertEqual(api.rows, {'groups': [], 'root-policies': [BASE], 'child-policies': []})

    def test_consumed_native_slot_check_precedes_all_auth_or_agent_calls(self):
        source = Path(owner.__file__).read_text()
        self.assertLess(source.index('if (parent / SLOT).exists():'), source.index('agent = ensure_agent()'))
        self.assertLess(source.index('if (parent / SLOT).exists():'), source.index('profile = ensure_session(minimum_seconds=1800)'))
        self.assertIn('Owner31NativeAllowanceConsumed_NoReplay', source)

    def test_expiry_during_auth_refresh_prevents_even_mutation_intent(self):
        try:
            import security_session
        except ImportError:
            self.skipTest('Native Linux wrapper is checked in the OCI Python runtime')
        profile = {'tenancy': ROOT, 'user': 'publicfixtureuser', 'region': scope.REGION}
        api = owner.NativeApi(profile, self.journal, create_guard=self.guard)
        self.guard(scope.DYNAMIC_GROUP)
        def session():
            self.now += timedelta(seconds=301)
            return profile
        with patch.object(security_session, 'ensure_session', side_effect=session), \
                patch.object(owner.subprocess, 'run') as execute:
            with self.assertRaisesRegex(eligibility.EligibilityError, 'FreshFiveMinute'):
                api.call('create-group')
            execute.assert_not_called()
        self.assertFalse(any(name.startswith('approved31-') for name in self.journal.values))
        self.assertFalse(api.creation_calls)


if __name__ == '__main__':
    unittest.main()
