import copy
import inspect
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p6_lifecycle as controller
import p6_lifecycle_guest as guest
from p4_recovery_guest import RecoveryError


def receipt(scenario):
    state, error = guest.EXPECTED[scenario]
    return {'state': state, 'errorCode': error, 'receiptConfirmed': state == 'submitted',
            'events': [{'state': name} for name in ('queued', 'running', 'submitting', state)]}


class NativeLifecycleTests(unittest.TestCase):
    def test_every_terminal_and_error_is_exact_never_ready_or_unknown_success(self):
        for scenario in guest.EXPECTED:
            self.assertEqual(guest.terminal(receipt(scenario), scenario)['status'], 'PASS')
            for key, value in [('state', 'ready'), ('errorCode', 'invented'), ('receiptConfirmed', None), ('events', [])]:
                row = receipt(scenario) | {key: value}
                with self.assertRaises(RecoveryError): guest.terminal(row, scenario)
        with self.assertRaises(RecoveryError): guest.work('real-employer')

    def test_fixture_is_named_actor_queue_only_parameterised_no_source_mutation(self):
        value = guest.work('success')
        self.assertEqual(value['actorEmail'], 'anvesh.mannuru+ir35test@gmail.com')
        normal = guest.producer_script(value)
        self.assertIn("mockOptions('producer')", normal)
        self.assertIn('new MockStore(producer,producer).enqueue(value)', normal)
        self.assertNotIn('PASSWORD', normal)
        orphan = guest.producer_script(value, orphan=True)
        self.assertIn('INSERT INTO pgboss.ir35_mock_application', orphan)
        self.assertIn("interval '60 seconds'", orphan)
        for wrong in (value | {'actorEmail': 'other@invalid.test'}, value | {'scenario': 'real'}, value | {'employerURL': 'https://forbidden.invalid'}):
            with self.assertRaises(RecoveryError): guest.producer_script(wrong)
        for forbidden in ('UPDATE ', 'DELETE ', 'ALTER ', 'GRANT ', 'public.', 'auth.', 'storage.'):
            self.assertNotIn(forbidden, orphan)

    def test_producer_keeps_secrets_in_original_vm_env_not_args_or_new_file(self):
        class Reply:
            returncode = 0
            stdout = b'{"inserted":true,"mock":true}'
        with patch.object(guest.subprocess, 'run', return_value=Reply()) as execute:
            guest.producer(guest.work('success'), orphan=True)
        args = execute.call_args.args[0]
        self.assertIn('/opt/ir35/.env.p6-mock-worker', args)
        self.assertIn('--input-type=module', args)
        self.assertNotIn('--env', args)
        self.assertNotIn('--env-file', args)
        self.assertIsInstance(execute.call_args.kwargs['input'], bytes)

    def test_no_default_native_run_and_write_once_controller(self):
        with patch.object(controller.sys, 'argv', ['p6_lifecycle.py']), patch.object(controller, 'credential_gate') as credentials:
            with self.assertRaisesRegex(RuntimeError, 'ExplicitNativeMockLifecycleRequired'): controller.main()
        credentials.assert_not_called()
        source = inspect.getsource(controller.main)
        self.assertIn("destination.open('x'", source)
        self.assertIn('Recorded_NoReplay', source)

    def test_record_before_assert_pause_on_failure_full_containment_required(self):
        source = inspect.getsource(guest.run)
        self.assertLess(source.index('record(name, observed)'), source.index('if not valid:'))
        self.assertLess(source.index("record('terminal-' + scenario, receipt)"), source.index('proof = terminal(receipt, scenario)'))
        self.assertIn("result['failurePause']", source)
        self.assertIn("check_containment(data, runtime, store, stage, 'failure')", source)
        self.assertLess(source.index("result['containment'] = check_containment"), source.index("result.update(status='PASS'"))
        self.assertIn('phaseComplete=False', source)
        self.assertIn('fresh-lifecycle-fixture', source)
        self.assertIn('durable-after-restart', source)
        self.assertIn('concurrent-browser-exclusion', source)
        for forbidden in ('private_new(', 'openssl', "['docker', 'rm'", "['docker', 'network'", 'ALTER ROLE', 'REVOKE ', 'DROP '):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
