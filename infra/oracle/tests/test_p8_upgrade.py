import inspect
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_upgrade as controller
from offline_bundle_fixture import public_bootstrap


class UpgradeTests(unittest.TestCase):
    def test_exact_pinned_git_migration_and_complete_guest_bundle_compile_offline(self):
        sql = (controller.schema.REPO / 'supabase/migrations/025_application_delivery_lifecycle.sql').read_text()
        with public_bootstrap():
            source = controller.program({'public': 'fixture'}, sql)
        compile(source, '<public-upgrade025>', 'exec')
        with self.assertRaisesRegex(RuntimeError, 'ExactReviewed025GitBytesRequired'):
            controller.program({}, sql + '\n-- changed')
        self.assertIn('ON_ERROR_STOP=1', source)

    def test_invalid_cli_never_reaches_private_context_or_vm(self):
        with patch.object(sys, 'argv', ['p8_upgrade.py', '--production']), patch.object(
                controller.staging, 'context', side_effect=AssertionError('private context touched')):
            with self.assertRaisesRegex(RuntimeError, 'ExplicitDisposableUpgradeOnlyRequired'):
                controller.main()

    def guest_module(self):
        # Load only definitions with public test modules; no Recovery/VM calls.
        modules = {name: types.ModuleType(name) for name in ('p4_recovery_guest', 'p6_restart_diagnosis_guest',
            'p6_hba_guest', 'web_edge_guest', 'p6_mock_guest', 'web_services_guest', 'p6_role_policy')}
        modules['p4_recovery_guest'].Recovery = object
        modules['p4_recovery_guest'].RecoveryError = type('RecoveryError', (RuntimeError,), {})
        for name, attribute in (('p6_restart_diagnosis_guest', 'containment'), ('p6_restart_diagnosis_guest', 'BRIDGE_PROBE'),
                ('p6_hba_guest', 'actual_login'), ('web_edge_guest', 'private_env'), ('p6_mock_guest', 'prepared'),
                ('web_services_guest', 'require_prepared')):
            setattr(modules[name], attribute, None)
        guest = types.ModuleType('public_upgrade_guest')
        with patch.dict(sys.modules, modules):
            path = controller.schema.REPO / 'infra/oracle/p8_upgrade_guest.py'
            exec(compile(path.read_text(), str(path), 'exec'), guest.__dict__)
        return guest

    def test_each_step_seals_result_even_on_failure_and_verifies_previous_stage(self):
        guest = self.guest_module()
        calls = []
        class Store:
            def stage(self, name): calls.append(('stage', name)); return Path(name)
            def put(self, stage, name, body): calls.append(('put', name, json.loads(body)))
            def seal(self, stage, previous=None): calls.append(('seal', stage.name, previous)); return stage.name
            def verify(self, name, anchor): calls.append(('verify', name, anchor))
        steps = guest.Steps(types.SimpleNamespace(store=lambda: Store()))
        steps.step(14, 'first', lambda stage: {'status': 'PASS'})
        def fail(stage): raise ValueError('ExistingAppRoleAccessBroadened_Abort')
        with self.assertRaisesRegex(guest.RecoveryError, 'P8UpgradeStepFailed_second'):
            steps.step(15, 'second', fail)
        result = steps.results['second']['result']
        self.assertEqual(result, {'status': 'FAIL', 'code': 'ExistingAppRoleAccessBroadened_Abort'})
        self.assertIn(('seal', '15-p8-upgrade01-second', '14-p8-upgrade01-first'), calls)
        first_verify = calls.index(('verify', '14-p8-upgrade01-first', '14-p8-upgrade01-first'))
        self.assertLess(first_verify, calls.index(('stage', '15-p8-upgrade01-second')))

    def test_private_error_values_are_not_journalled(self):
        guest = self.guest_module()
        class Store:
            def stage(self, name): return Path(name)
            def put(self, *unused): pass
            def seal(self, stage, previous=None): return 'hash'
            def verify(self, *unused): pass
        steps = guest.Steps(types.SimpleNamespace(store=lambda: Store()))
        def fail(stage): raise ValueError('not-a-real-secret-sentinel')
        with self.assertRaises(guest.RecoveryError): steps.step(14, 'first', fail)
        self.assertNotIn('sentinel', json.dumps(steps.results))

    def test_raw_hashes_and_pristine_post_containment_are_not_replaced(self):
        guest = self.guest_module()
        source = inspect.getsource(guest.run)
        self.assertIn('proof = recovery.check_database()', source)
        self.assertIn("steps.store.put(stage, 'clone-before.json'", source)
        self.assertIn('upgrade_review.assert_owned_clone', source)
        self.assertIn("result['fullContainment'] = final", source)
        self.assertNotIn('ALTER ROLE', source)
        self.assertNotIn('DISABLE TRIGGER', source)
        self.assertNotIn("'docker', 'restart'", source)
        self.assertNotIn('force', source.lower())


if __name__ == '__main__':
    unittest.main()
