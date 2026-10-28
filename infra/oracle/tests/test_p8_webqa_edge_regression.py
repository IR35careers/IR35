import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p8_webqa_edge_regression as gate


class QaEdgeCiTests(unittest.TestCase):
    def test_same_handler_tree_with_only_exact_fixture_endpoints_substituted(self):
        value = gate.stub_config('172.18.0.1', 'synthetic-bcrypt-not-real')
        self.assertIn(':8080 {', value); self.assertNotIn('    tls ', value)
        self.assertEqual(value.count('qa-edge-stub:8081'), 2)
        self.assertIn('basic_auth {', value)
        self.assertIn('request_header @restore_bearer Authorization "{vars.original_auth}"', value)
        self.assertIn('respond @not_tunnel "Forbidden" 403', value)
        self.assertIn('auto_https off', value)
        for forbidden in ('{$STAGING_', 'ir35-p5-', 'reverse_proxy ir35-p8-', '/data/certificates/'):
            self.assertNotIn(forbidden, value)

    def test_failure_is_recorded_and_sealed_before_fail_result_no_replay(self):
        with tempfile.TemporaryDirectory() as root, patch.object(gate, 'command', side_effect=RuntimeError('SyntheticReadFailure')):
            result = gate.run(root)
            self.assertEqual(result['status'], 'FAIL'); self.assertEqual(result['code'], 'SyntheticReadFailure')
            self.assertEqual(result['cleanup'], 'PASS'); self.assertEqual(result['vmCalls'], 0)
            stage = Path(root) / '01-owned-edge'
            self.assertEqual(json.loads((stage / 'result.json').read_text())['code'], 'SyntheticReadFailure')
            anchor = result['manifestSHA256']; gate.Store(root).verify('01-owned-edge', anchor)
            with self.assertRaises(FileExistsError): gate.run(root)
            self.assertEqual(gate.Store(root).verify('01-owned-edge', anchor)['stage'], '01-owned-edge')

    def test_native_validation_script_is_ci_only_and_does_not_mount_real_data_or_keys(self):
        source = Path(gate.__file__).read_text()
        for forbidden in ('schema.run_guest', '132.145.28.134', 'StrictHostKeyChecking', 'ssh-add', 'POSTGRES_PASSWORD',
                          'JWT_SECRET', '/opt/ir35/data', 'docker.sock', '--publish', '--network=host'):
            self.assertNotIn(forbidden, source)
        self.assertIn("['adapt', '--config'", source); self.assertIn("['validate', '--config'", source)
        workflow = Path(gate.__file__).resolve().parents[2] / '.github/workflows/quality.yml'
        body = workflow.read_text()
        self.assertIn('sdk_gate_private.py --mode baseline', body)
        self.assertIn('sdk_gate_private.py --mode fixed', body)
        self.assertIn('p8_webqa_edge_regression.py --root', body)

    def test_unexpected_failure_keeps_code_location_not_its_message_and_cli_keeps_complete_result(self):
        with tempfile.TemporaryDirectory() as root, patch.object(gate, 'command', side_effect=ValueError('fixture-sensitive-value-must-stay-private')):
            result = gate.run(root)
            self.assertEqual(result['status'], 'FAIL'); self.assertEqual(result['errorClass'], 'ValueError')
            self.assertTrue(result['failureFrames'])
            self.assertNotIn('fixture-sensitive-value', json.dumps(result))
            self.assertNotIn('code', result)
        source = Path(gate.__file__).read_text()
        self.assertIn('print(json.dumps(result, sort_keys=True))', source)
