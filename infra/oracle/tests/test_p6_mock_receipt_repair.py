import inspect
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p6_mock_receipt_repair as controller
import p6_mock_receipt_repair_guest as guest
import p6_health_repair_guest as proxy


class ReceiptHandoverTests(unittest.TestCase):
    def test_no_implicit_execution_or_replay(self):
        with patch.object(controller.sys, 'argv', ['p6_mock_receipt_repair.py']), patch.object(controller, 'credential_gate') as auth:
            with self.assertRaisesRegex(RuntimeError, 'ExplicitReceiptRepairHandoverRequired'): controller.main()
        auth.assert_not_called()
        source = inspect.getsource(controller.main)
        self.assertIn('ReceiptRepairHandoverRecorded_NoReplay', source)
        self.assertIn("destination.open('x'", source)

    def test_third_container_only_overrides_public_sha_with_same_secret_mount(self):
        value = guest.configuration('sha256:' + 'a' * 64, 'b' * 40)
        service = value['services']['worker']
        self.assertEqual(service['container_name'], 'ir35-p6-mock-worker-v3')
        self.assertEqual(service['entrypoint'][3], 'IR35_BUILD_SHA=' + 'b' * 40)
        self.assertEqual(service['entrypoint'][1], '/opt/ir35/.env.p6-mock-worker')
        self.assertTrue(service['init'])
        self.assertEqual(service['mem_limit'], '2560m')
        self.assertNotIn('environment', service)
        self.assertEqual(service['ports'], ['127.0.0.1:8787:8787/tcp'])
        self.assertIn(proxy.RECEIPT_UNIT + '.socket', proxy.units('172.20.0.2', unit=proxy.RECEIPT_UNIT))
        with self.assertRaises(RuntimeError): proxy.units('172.20.0.2', unit='unapproved-unit')

    def test_bounded_repair_keeps_old_files_and_full_containment_on_failure(self):
        source = inspect.getsource(guest.run)
        self.assertIn("store.stage('15-receipt-repair-one-handover')", source)
        self.assertIn("with COMPOSE.open('x')", source)
        self.assertIn('for report in (prior, failure, probe)', source)
        self.assertIn('anchored_result(store, report)', source)
        self.assertLess(source.index("result['containment'] = check_containment"), source.index("result.update(status='PASS'"))
        self.assertIn("result['failureContainment']", source)
        self.assertIn("old_health.get('paused') is not True", source)
        for wrong in ('openssl', 'private_new(', 'ALTER ROLE', 'GRANT ', 'REVOKE ', "['docker', 'rm'", 'ufw'):
            self.assertNotIn(wrong, source)


if __name__ == '__main__':
    unittest.main()
