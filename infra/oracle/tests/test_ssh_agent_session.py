import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ssh_agent_session as agent
from key_ceremony import KeySafetyError, write_new

FINGERPRINT = "SHA256:" + "A" * 43


class AgentTests(unittest.TestCase):
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
