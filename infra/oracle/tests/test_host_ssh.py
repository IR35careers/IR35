from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host_ssh
from key_ceremony import KeySafetyError


class HostTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
