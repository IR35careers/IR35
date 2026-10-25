import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ssh_agent_session as agent
from key_ceremony import KeySafetyError, write_new

FINGERPRINT = "SHA256:" + "A" * 43


class AgentTests(unittest.TestCase):
    def test_owner_fresh_lease_preserves_old_receipts_and_has_one_new_prompt_only(self):
        old = json.dumps({'fingerprint': FINGERPRINT, 'lifetimeSeconds': 14400,
                          'expiresAt': time.time() - 30, 'monotonicExpiresAt': time.monotonic() - 30}).encode()
        write_new(self.directory / 'load-owner-four-hour-20261025-result.json', old)
        write_new(self.directory / 'load-owner-four-hour-20261025.json', b'original attempt retained')
        responses = [self.result(1), self.result(0), self.result(0, '256 ' + FINGERPRINT + ' fixture (ED25519)')]
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', side_effect=responses) as native:
            proof = agent.ensure_agent(load=True, owner_four_hour_reopen=True)
        self.assertTrue(proof['keyLoaded'])
        self.assertGreater(proof['keyLifetimeSecondsRemaining'], 14390)
        self.assertEqual(native.call_args_list[1].args[0], ['ssh-add', '-t', '4h', str(agent.KEY_DIRECTORY / 'ssh_ed25519')])
        self.assertEqual((self.directory / 'load-owner-four-hour-20261025-result.json').read_bytes(), old)
        self.assertEqual((self.directory / 'load-owner-four-hour-20261025.json').read_bytes(), b'original attempt retained')
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaisesRegex(KeySafetyError, 'already requested'):
                agent.ensure_agent(load=True, owner_four_hour_reopen=True)
        self.assertEqual(native.call_count, 1)
        with patch.object(agent.subprocess, 'run', return_value=self.result(0, '256 ' + FINGERPRINT + ' fixture (ED25519)')):
            self.assertGreater(agent.ensure_agent()['keyLifetimeSecondsRemaining'], 14390)

    def test_fresh_lease_refuses_unexpired_original_or_noninteractive_or_mixed_flags(self):
        write_new(self.directory / 'load-owner-four-hour-20261025-result.json', json.dumps({
            'fingerprint': FINGERPRINT, 'lifetimeSeconds': 14400, 'expiresAt': time.time() + 3600}).encode())
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', return_value=self.result(1)) as native:
            with self.assertRaisesRegex(KeySafetyError, 'VerifiedExpired'):
                agent.ensure_agent(load=True, owner_four_hour_reopen=True)
        self.assertEqual(native.call_count, 1)
        for options in ({'owner_four_hour_reopen': True}, {'load': True, 'owner_four_hour_reopen': True, 'owner_four_hour': True}):
            with self.assertRaises(KeySafetyError): agent.ensure_agent(**options)

    def test_owner_four_hour_prompt_uses_exact_ttl_verifies_fingerprint_and_never_repeats(self):
        write_new(self.directory / 'load-attempt.json', b'original-preserved')
        responses = [self.result(1), self.result(0), self.result(0, '256 ' + FINGERPRINT + ' fixture (ED25519)')]
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', side_effect=responses) as run:
            result = agent.ensure_agent(load=True, owner_four_hour=True)
        self.assertEqual(run.call_args_list[1].args[0], ['ssh-add', '-t', '4h', str(agent.KEY_DIRECTORY / 'ssh_ed25519')])
        self.assertTrue(result['keyLoaded'])
        self.assertEqual(result['keyFingerprint'], FINGERPRINT)
        self.assertGreater(result['keyLifetimeSecondsRemaining'], 14390)
        self.assertEqual((self.directory / 'load-attempt.json').read_bytes(), b'original-preserved')
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), patch.object(agent.sys.stdout, 'isatty', return_value=True), \
                patch.object(agent.subprocess, 'run', return_value=self.result(1)) as run:
            with self.assertRaises(KeySafetyError):
                agent.ensure_agent(load=True, owner_four_hour=True)
        self.assertEqual(run.call_count, 1)

    def test_explicit_owner_retry_preserves_first_attempt_and_consumes_only_one_extra_slot(self):
        write_new(self.directory/'load-attempt.json',b'{"promptAttempted":true}\n')
        original=(self.directory/'load-attempt.json').read_bytes()
        with patch.object(agent.sys.stdin,'isatty',return_value=True),patch.object(agent.sys.stdout,'isatty',return_value=True),patch.object(agent.subprocess,'run',side_effect=[self.result(1),self.result(1)]) as run:
            with self.assertRaises(KeySafetyError):agent.ensure_agent(load=True,owner_retry=True)
        self.assertEqual(run.call_count,2)
        self.assertTrue((self.directory/'load-owner-retry-1.json').is_file())
        self.assertEqual((self.directory/'load-attempt.json').read_bytes(),original)
        with patch.object(agent.sys.stdin,'isatty',return_value=True),patch.object(agent.sys.stdout,'isatty',return_value=True),patch.object(agent.subprocess,'run',return_value=self.result(1)) as run:
            with self.assertRaises(KeySafetyError):agent.ensure_agent(load=True,owner_retry=True)
        self.assertEqual(run.call_count,1)

    def test_owner_retry_cannot_silently_replace_the_normal_first_prompt(self):
        with patch.object(agent.sys.stdin,'isatty',return_value=True),patch.object(agent.sys.stdout,'isatty',return_value=True),patch.object(agent.subprocess,'run',return_value=self.result(1)) as run:
            with self.assertRaises(KeySafetyError):agent.ensure_agent(load=True,owner_retry=True)
        self.assertEqual(run.call_count,1)
        self.assertFalse((self.directory/'load-owner-retry-1.json').exists())

    def test_hold_only_after_verified_load_has_no_secret_input_or_polling(self):
        with patch.object(agent,'ensure_agent',return_value={'agentReady':True,'keyLoaded':True,'socket':'private-path'}) as ensure,patch.object(agent.signal,'pause') as pause,patch('builtins.print') as output:
            agent.cli(['load-and-hold'])
        ensure.assert_called_once_with(load=True);pause.assert_called_once_with()
        self.assertNotIn('private-path',str(output.call_args_list))
        with patch.object(agent,'ensure_agent',return_value={'agentReady':True,'keyLoaded':False}),patch.object(agent.signal,'pause') as pause,patch('builtins.print'):
            with self.assertRaises(KeySafetyError):agent.cli(['load-and-hold'])
        pause.assert_not_called()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.directory.chmod(0o700)
        endpoint = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        endpoint.bind(str(self.directory / "agent.sock"))
        (self.directory / "agent.sock").chmod(0o600)
        self.addCleanup(endpoint.close)
        write_new(self.directory / "agent.json", json.dumps({"pid": 1}).encode())
        for target, value in (("boot_directory", self.directory), ("expected_fingerprint", FINGERPRINT)):
            mock = patch.object(agent, target, return_value=value)
            mock.start()
            self.addCleanup(mock.stop)

    def result(self, code, stdout=""):
        return subprocess.CompletedProcess([], code, stdout, "")

    def test_loaded_identity_never_prompts_or_restarts_agent(self):
        with patch.object(agent.subprocess, "run", return_value=self.result(0, "256 " + FINGERPRINT + " fixture (ED25519)")) as run:
            self.assertTrue(agent.ensure_agent(load=True)["keyLoaded"])
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], ["ssh-add", "-l"])

    def test_check_never_prompts_and_strips_askpass(self):
        with patch.dict(os.environ, {"SSH_ASKPASS": "untrusted", "SSH_ASKPASS_REQUIRE": "force"}), \
                patch.object(agent.subprocess, "run", return_value=self.result(1)) as run:
            self.assertFalse(agent.ensure_agent()["keyLoaded"])
            self.assertNotIn("SSH_ASKPASS", run.call_args.kwargs["env"])
            self.assertNotIn("SSH_ASKPASS_REQUIRE", run.call_args.kwargs["env"])

    def test_attempt_is_recorded_before_native_prompt_never_repeated(self):
        with patch.object(agent.sys.stdin, "isatty", return_value=True), patch.object(agent.sys.stdout, "isatty", return_value=True), \
                patch.object(agent.subprocess, "run", side_effect=[self.result(1), self.result(1)]) as run:
            with self.assertRaises(KeySafetyError):
                agent.ensure_agent(load=True)
            self.assertTrue((self.directory / "load-attempt.json").is_file())
            self.assertEqual(run.call_count, 2)
        with patch.object(agent.sys.stdin, "isatty", return_value=True), patch.object(agent.sys.stdout, "isatty", return_value=True), \
                patch.object(agent.subprocess, "run", return_value=self.result(1)) as run:
            with self.assertRaises(KeySafetyError) as error:
                agent.ensure_agent(load=True)
            self.assertIn("already requested this boot", str(error.exception))
            self.assertEqual(run.call_count, 1)

    def test_broken_socket_or_unreachable_agent_never_restarts(self):
        with patch.object(agent.subprocess, "run", return_value=self.result(2)) as run:
            with self.assertRaises(KeySafetyError):
                agent.ensure_agent()
            self.assertEqual(run.call_count, 1)
        (self.directory / "agent.sock").chmod(0o666)
        with patch.object(agent.subprocess, "run") as run:
            with self.assertRaises(KeySafetyError):
                agent.ensure_agent()
            run.assert_not_called()
