import inspect
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p6_mock_update_guest as update
import p6_mock_update as controller
from p4_recovery_guest import RecoveryError


class MockUpdateTests(unittest.TestCase):
    def test_security_probe_must_precede_success_and_exceptions_force_failure(self):
        source = inspect.getsource(update.run)
        self.assertLess(source.index("result['queueRoleCustomerAccess'] = no_customer_access(recovery)"), source.index("result.update(status='PASS'"))
        self.assertIn("result.update(status='FAIL', code=", source)
        self.assertIn("result['rollbackError']", source)

    def test_new_container_keeps_old_secret_file_and_changes_only_public_sha(self):
        config = update.compose_two('sha256:' + 'a' * 64, 'b' * 40)
        service = config['services']['worker']
        self.assertEqual(service['container_name'], update.NEW_NAME)
        self.assertTrue(service['init'])
        self.assertEqual(service['user'], '1002:1002')
        self.assertEqual(service['mem_limit'], '2560m')
        self.assertEqual(service['ports'], ['127.0.0.1:8787:8787/tcp'])
        self.assertEqual(service['entrypoint'][1], '/opt/ir35/.env.p6-mock-worker')
        self.assertEqual(service['entrypoint'][3], 'IR35_BUILD_SHA=' + 'b' * 40)
        self.assertNotIn('environment', service)
        self.assertNotIn('env_file', service)
        self.assertNotIn('docker.sock', json.dumps(config))
        with self.assertRaises(RecoveryError):
            update.compose_two('sha256:' + 'a' * 64, 'not-a-sha')

    def test_only_explicit_activation_can_read_private_context(self):
        with patch.object(controller.sys, 'argv', ['p6_mock_update.py']), patch.object(controller.p6_context, 'context') as context:
            with self.assertRaisesRegex(RuntimeError, 'ExplicitBuildTwoMockActivationRequired'):
                controller.main()
        context.assert_not_called()

    def test_existing_activation_refuses_replay_before_any_mutation(self):
        build = {'status': 'PASS', 'attempt': 2, 'image': 'sha256:' + 'b' * 64}
        data = {'workerBuild': build, 'originalWorkerBuild': {'image': 'sha256:' + 'a' * 64},
                'healthRepair': {'status': 'PASS', 'containment': {'status': 'PASS'}, 'stage': '08-mock-health-repair-one', 'manifestSHA256': 'a' * 64}}
        store = Mock()
        store.stage.return_value = Path('/opt/ir35/.env.p6/09-mock-runtime-update-two')
        store.seal.return_value = 'c' * 64
        run = Mock(return_value=update.NEW_NAME + '\n')
        with patch.object(update, 'prerequisites'), patch.object(update, 'prepared', return_value=store), \
                patch.object(update, 'check_containment', return_value={'status': 'PASS'}), patch.object(update.subprocess, 'run') as native:
            result = update.run(data, {'run': run})
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['newWorkerStarts'], 0)
        self.assertEqual(result['code'], 'BuildTwoActivationAlreadyExists_NoReplay')
        native.assert_not_called()
        self.assertTrue(all(call.args[0][:3] == ['docker', 'ps', '-a'] for call in run.call_args_list))

    def test_update_has_no_network_secret_role_or_old_artifact_rewrite(self):
        source = inspect.getsource(update)
        for forbidden in ('openssl', 'private_new(', 'ALTER ROLE', 'CREATE ROLE', 'iptables', 'ufw', "['docker', 'network', 'connect'", "['docker', 'rm'", "['docker', 'restart'"):
            self.assertNotIn(forbidden, source)
        self.assertIn('with NEW_COMPOSE.open(\'x\')', source)
        self.assertIn('unit=UPDATE_UNIT', source)
        self.assertIn("check_containment(data, runtime, store, stage, 'post')", source)


if __name__ == '__main__':
    unittest.main()
