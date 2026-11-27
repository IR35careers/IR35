import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_lifecycle_owner23 as entry
import p8_lifecycle_owner31 as owner
from test_p8_lifecycle_owner31 import FakeApi, Journal, ROOT, BASE, immediate

PARENT = Path(__file__).resolve().parents[3] / 'docs/evidence/p8'


class Owner23EntryTests(unittest.TestCase):
    def test_exact_retained_failure_and_rollback_are_verified_read_only(self):
        self.assertEqual(entry.verify_previous_failure(PARENT), entry.PREVIOUS_FAILURE_MANIFEST)
        self.assertNotEqual(entry.SLOT, entry.PREVIOUS_SLOT)
        self.assertEqual(entry.PREVIOUS_SLOT, owner.SLOT)

    def test_used_new_slot_rejects_before_prior_verifier_or_auth(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            (parent / entry.SLOT).mkdir()
            with patch.object(entry, 'verify_previous_failure') as verify:
                with self.assertRaisesRegex(owner.OwnerRunError, 'Owner23NativeAllowanceConsumed'):
                    entry.check_entry(parent)
                verify.assert_not_called()

    def test_bad_prior_manifest_cannot_reach_auth(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            prior = parent / entry.PREVIOUS_SLOT
            prior.mkdir()
            (prior / 'manifest.json').write_text('{"version":1,"artifacts":[]}')
            with self.assertRaisesRegex(owner.OwnerRunError, 'ExactPriorManifestRequired'):
                entry.check_entry(parent)

    def test_wrong_failure_or_rollback_fields_cannot_reopen(self):
        original = json.loads((PARENT / entry.PREVIOUS_SLOT / 'result.json').read_bytes())
        cases = []
        for field, value in (('status', 'PASS'), ('code', 'DifferentFailure'), ('nativeRetryAllowed', True)):
            result = copy.deepcopy(original)
            result[field] = value
            cases.append(result)
        for field, value in (('status', 'FAIL'), ('createdResourcesRemoved', 2),
                             ('createdResourcesRemoved', True), ('createdLifecycleRemoved', True),
                             ('originalRootPolicySHA256', '0' * 64)):
            result = copy.deepcopy(original)
            result['rollback'][field] = value
            cases.append(result)
        for result in cases:
            with self.subTest(result=result):
                with tempfile.TemporaryDirectory() as temporary:
                    parent = Path(temporary)
                    prior = parent / entry.PREVIOUS_SLOT
                    prior.mkdir()
                    (prior / 'result.json').write_text(json.dumps(result))
                    with patch.object(entry, 'verified_public_manifest', return_value=entry.PREVIOUS_FAILURE_MANIFEST):
                        with self.assertRaisesRegex(owner.OwnerRunError, 'ExactFreshnessFailure'):
                            entry.verify_previous_failure(parent)

    def test_fixed_flag_and_pre_auth_guard_no_generic_override(self):
        for arguments in ([], [entry.FLAG, '--slot', 'other'], ['--apply-owner-20261031-one-bounded-run']):
            with self.assertRaisesRegex(owner.OwnerRunError, 'ExplicitOwner23'):
                entry.main(arguments)
        with patch.object(entry, 'check_entry', side_effect=owner.OwnerRunError('GuardBeforeAuth')) as check:
            with self.assertRaisesRegex(owner.OwnerRunError, 'GuardBeforeAuth'):
                entry.main([entry.FLAG])
            check.assert_called_once_with(PARENT)

    def test_same_reviewed_orchestration_and_exact_policy_scope(self):
        self.assertIs(entry.OwnerRun, owner.OwnerRun)
        self.assertIs(entry.NativeApi, owner.NativeApi)
        api, journal = FakeApi(), Journal()
        with patch.object(owner, 'ROOT_POLICY_SHA', owner.sha(BASE['statements'])):
            run = entry.OwnerRun(api, journal, ROOT, lambda *_args, **_kw: None, immediate)
            result = run.execute()
            self.assertEqual(result['status'], 'PASS')
            self.assertEqual(result['policyTexts']['vm'], owner.scope.policy_statement())
            self.assertEqual(result['policyTexts']['service'], owner.service_statements())
            self.assertEqual([name for name, _ in api.calls if name.startswith('create-')],
                             ['create-group', 'create-vm-policy', 'create-service-policy', 'create-lifecycle'])
            rollback = run.rollback()
            self.assertEqual(rollback['status'], 'PASS')
            self.assertEqual(rollback['createdResourcesRemoved'], 3)


if __name__ == '__main__':
    unittest.main()
