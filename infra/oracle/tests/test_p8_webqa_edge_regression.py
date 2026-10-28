import json
from pathlib import Path
import sys
import tempfile
import subprocess
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

    def test_ci_mount_custody_matches_passing_baseline_not_shared_root_defaults(self):
        with patch.object(gate.os, 'getuid', return_value=1001): flags = gate.common_flags()
        self.assertEqual(flags[flags.index('--user') + 1], '1001:1001')
        for path, size in (('/tmp', '16m'), ('/data', '1m'), ('/config', '1m')):
            self.assertIn(f'{path}:rw,size={size},uid=1001,gid=1001,mode=0700', flags)
        self.assertIn('--read-only', flags); self.assertIn('--cap-drop', flags)
        self.assertNotIn('NET_BIND_SERVICE', flags)  # Validation command alone gets the existing CI capability.

    def test_public_synthetic_docker_stderr_is_bounded_and_fixture_credentials_are_removed(self):
        stderr = (gate.PASSWORD + ' ' + gate.TOKEN + ' Authorization: Bearer fixture-private ' + 'x' * 5000).encode()
        reply = subprocess.CompletedProcess(['docker', 'run'], 255, stdout=b'', stderr=stderr)
        with patch.object(gate.subprocess, 'run', return_value=reply):
            with self.assertRaises(gate.SyntheticDockerError) as caught: gate.command(['docker', 'run'])
        value = caught.exception.diagnostic
        self.assertEqual(value['exitCode'], 255); self.assertEqual(value['stderrBytes'], len(stderr))
        self.assertEqual(len(value['stderrSHA256']), 64); self.assertTrue(value['truncated'])
        self.assertLessEqual(len(value['syntheticStderr']), 4000)
        for secret in (gate.PASSWORD, gate.TOKEN, 'fixture-private'): self.assertNotIn(secret, value['syntheticStderr'])
        with tempfile.TemporaryDirectory() as root, patch.object(gate, 'command', side_effect=caught.exception):
            result = gate.run(root)
            self.assertEqual(result['code'], 'PrivateDockerCommandFailed_255')
            self.assertEqual(result['dockerDiagnostic'], value)
