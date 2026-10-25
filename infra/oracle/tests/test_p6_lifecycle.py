import copy
import inspect
import json
from pathlib import Path
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p6_lifecycle as controller
import p6_lifecycle_guest as guest
from p4_recovery_guest import RecoveryError


def receipt(scenario):
    state, error = guest.EXPECTED[scenario]
    return {'state': state, 'errorCode': error, 'receiptConfirmed': state == 'submitted',
            'events': [{'state': name} for name in ('queued', 'running', 'submitting', state)]}


class NativeLifecycleTests(unittest.TestCase):
    def test_repair_preserves_all_four_actual_failure_receipts_not_new_expected_values(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage = root / '12-native-mock-lifecycle'
            stage.mkdir()
            failed = {'status': 'FAIL', 'stage': stage.name, 'manifestSHA256': 'a' * 64,
                      'code': 'NativeMockTerminalOrHistoryMismatch_NoReadyFallback', 'failureContainment': {'status': 'PASS'}}
            (stage / 'result.json').write_text(json.dumps({key: value for key, value in failed.items() if key not in ('stage', 'manifestSHA256')}))
            artifacts = []
            for index, scenario in enumerate(('success', 'server_error', 'timeout', 'lost_ack'), 1):
                row = receipt(scenario) | {'applicationId': f'{index:08x}-0000-4000-8000-000000000000'}
                if scenario == 'lost_ack': row['errorCode'] = 'mock_browser_failed'
                name = f'{index:03d}-terminal-{scenario}.json'
                (stage / name).write_text(json.dumps(row))
                artifacts.append({'name': name})
            store = Mock(root=root)
            store.verify.return_value = {'artifacts': artifacts}
            kept = guest.retained_receipts(store, failed)
            self.assertEqual(len(kept), 4)
            self.assertEqual(kept['00000004-0000-4000-8000-000000000000']['errorCode'], 'mock_browser_failed')
            # It must NOT rewrite the old failure to the newly fixed outcome.
            original = json.loads((stage / artifacts[-1]['name']).read_text())
            original['errorCode'] = 'mock_unknown_outcome'
            (stage / artifacts[-1]['name']).write_text(json.dumps(original))
            with self.assertRaisesRegex(RecoveryError, 'OriginalReceiptEvidenceChanged'):
                guest.retained_receipts(store, failed)

    def test_repair_has_new_stage_but_original_empty_fixture_assertion_is_retained(self):
        source = inspect.getsource(guest.run)
        self.assertIn("'16-native-mock-lifecycle-repair-one' if repair_one else '12-native-mock-lifecycle'", source)
        self.assertIn("empty == {'applications': 0, 'schedules': 0, 'applyJobs': 0}", source)
        self.assertIn("empty == {'applications': 4, 'schedules': 0, 'applyJobs': 4}", source)
        self.assertIn('snapshots = dict(prior_receipts)', source)
        self.assertIn('actual_receipt == before', source)

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
