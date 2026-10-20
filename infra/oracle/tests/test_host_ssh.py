from pathlib import Path
import subprocess
import sys
import unittest
import json
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host_ssh
from key_ceremony import KeySafetyError


class HostTests(unittest.TestCase):
    def test_nonroot_login_keeps_pinning_and_never_uses_sudo_or_root_ssh(self):
        with self.assertRaises(KeySafetyError):
            host_ssh.run_remote("print('ignored')", [], user="root")
        state = {"verified": True, "knownHostsLine": "fixture", "publicIP": "8.8.8.8"}
        def private(path):
            return json.dumps(state) if path == host_ssh.HOST_JOURNAL else "fixture"
        result = subprocess.CompletedProcess([], 0, '{"uid":1001}', "")
        with patch.object(host_ssh, "private_file", side_effect=private), \
                patch.object(host_ssh, "ensure_agent", return_value={"keyLoaded": True, "socket": "/fixture/agent"}), \
                patch.object(host_ssh.subprocess, "run", return_value=result) as ssh:
            self.assertEqual(host_ssh.run_remote("public_script", [], user="ir35"), {"uid": 1001})
            args = ssh.call_args.args[0]
            self.assertIn("ir35@8.8.8.8", args)
            self.assertIn("StrictHostKeyChecking=yes", args)
            self.assertIn("ForwardAgent=no", args)
            self.assertNotIn("sudo", args[-1])
    def test_only_connection_transport_is_reboot_transient_not_auth_or_changed_keys(self):
        self.assertTrue(host_ssh.connection_not_ready(255, "Connection refused"))
        self.assertTrue(host_ssh.connection_not_ready(255, "Connection reset by peer"))
        for value in ("Permission denied (publickey)", "Host key verification failed", "REMOTE HOST IDENTIFICATION HAS CHANGED\nConnection closed by host"):
            self.assertFalse(host_ssh.connection_not_ready(255, value))
        self.assertFalse(host_ssh.connection_not_ready(1, "Connection refused"))
    def test_requires_console_match_including_plus_suffix_fingerprint(self):
        line = "8.8.8.8 ssh-ed25519 " + "A" * 68
        fingerprint = "SHA256:" + "A" * 42 + "+"
        with patch.object(host_ssh.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "256 " + fingerprint + " (ED25519)", "")):
            self.assertEqual(host_ssh.match_host_key("8.8.8.8", line, "Oracle console\n" + fingerprint + " (ED25519)"), (line + "\n", fingerprint))
            with self.assertRaises(KeySafetyError):
                host_ssh.match_host_key("8.8.8.8", line, "different console")
            with self.assertRaises(KeySafetyError):
                host_ssh.match_host_key("8.8.4.4", line, fingerprint)

    def test_missing_console_fingerprint_does_not_enrol_or_claim_key_changed(self):
        with patch.object(host_ssh.subprocess, "run") as process:
            with self.assertRaisesRegex(KeySafetyError, "contains no SHA256 host fingerprint"):
                host_ssh.match_host_key("8.8.8.8", "8.8.8.8 ssh-ed25519 " + "A" * 68, "boot without fingerprint")
            process.assert_not_called()

    def test_explicit_ecdsa_source_can_match_without_weakening_default_ed25519(self):
        fingerprint = "SHA256:" + "B" * 43
        key = "8.8.8.8 ecdsa-sha2-nistp256 " + "A" * 120
        with patch.object(host_ssh.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "256 " + fingerprint + " (ECDSA)", "")):
            self.assertEqual(host_ssh.match_host_key("8.8.8.8", key, fingerprint, "ecdsa")[1], fingerprint)
            with self.assertRaises(KeySafetyError):
                host_ssh.match_host_key("8.8.8.8", key, fingerprint)


if __name__ == "__main__":
    unittest.main()
