import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import pty
import select
import stat
import subprocess
import sys
import tempfile
import termios
import time
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization

SCRIPT = Path(__file__).resolve().parents[1] / "key_ceremony.py"
SPEC = importlib.util.spec_from_file_location("key_ceremony", SCRIPT)
ceremony = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ceremony)


class KeyCeremonyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ir35-key-test-")
        self.parent = Path(self.temp.name)
        self.parent.chmod(0o700)
        self.destination = self.parent / "new"
        self.ssh_pass = b"mock-only-ssh-passphrase-not-a-credential"
        self.api_pass = b"mock-only-api-passphrase-not-a-credential"

    def tearDown(self):
        self.temp.cleanup()

    def test_real_encrypted_keys_round_trip_and_private_modes(self):
        report = ceremony.create_keys(self.destination, self.ssh_pass, self.api_pass)
        self.assertTrue(report["encrypted"] and report["roundTripVerified"])
        self.assertEqual(report["cloudCalls"], 0)
        self.assertFalse(report["existingRegisteredKeyChanged"])
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o700)
        for path in self.destination.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(path.stat().st_uid, os.getuid())
        ssh_bytes = (self.destination / "ssh_ed25519").read_bytes()
        api_bytes = (self.destination / "oci_api.pem").read_bytes()
        with self.assertRaises((TypeError, ValueError)):
            serialization.load_ssh_private_key(ssh_bytes, None)
        with self.assertRaises((TypeError, ValueError)):
            serialization.load_pem_private_key(api_bytes, None)
        with self.assertRaises(ValueError):
            serialization.load_ssh_private_key(ssh_bytes, b"wrong-mock-passphrase")
        with self.assertRaises(ValueError):
            serialization.load_pem_private_key(api_bytes, b"wrong-mock-passphrase")
        self.assertEqual(serialization.load_pem_private_key(api_bytes, self.api_pass).key_size, 3072)
        pub = serialization.load_ssh_private_key(ssh_bytes, self.ssh_pass).public_key()
        self.assertEqual(pub.public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH),
                         (self.destination / "ssh_ed25519.pub").read_bytes().split(b" ir35-")[0])
        # A real OpenSSH client parses the public key, with no private value in args/logs.
        parsed = subprocess.run(["ssh-keygen", "-lf", str(self.destination / "ssh_ed25519.pub")],
                                capture_output=True, check=False)
        self.assertEqual(parsed.returncode, 0)
        encoded = json.dumps(report).encode()
        self.assertNotIn(self.ssh_pass, encoded)
        self.assertNotIn(self.api_pass, encoded)
        self.assertNotIn(ssh_bytes, encoded)
        self.assertNotIn(api_bytes, encoded)

    def test_previous_directory_never_overwritten(self):
        self.destination.mkdir(mode=0o700)
        with self.assertRaises(FileExistsError):
            ceremony.create_keys(self.destination, self.ssh_pass, self.api_pass)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_symlinked_or_shared_parent_rejected(self):
        linked = self.parent / "linked"
        linked.symlink_to(self.parent, target_is_directory=True)
        with self.assertRaises(ceremony.KeySafetyError):
            ceremony.create_keys(linked / "new", self.ssh_pass, self.api_pass)
        self.parent.chmod(0o755)
        with self.assertRaises(ceremony.KeySafetyError):
            ceremony.create_keys(self.destination, self.ssh_pass, self.api_pass)
        self.assertFalse(self.destination.exists())

    def test_invalid_passphrase_creates_nothing(self):
        for invalid in ["", "short", "x" * 257, "x" * 16 + "\n", "x" * 16 + "\0"]:
            with self.assertRaises(ceremony.KeySafetyError):
                ceremony.create_keys(self.destination, invalid.encode(), self.api_pass)
            self.assertFalse(self.destination.exists())

    def test_new_file_is_exclusive_and_never_follows_symlink(self):
        target = self.parent / "existing"
        target.write_bytes(b"unchanged")
        link = self.parent / "link"
        link.symlink_to(target)
        for candidate in [target, link]:
            with self.assertRaises(FileExistsError):
                ceremony.write_new(candidate, b"must-not-replace")
        self.assertEqual(target.read_bytes(), b"unchanged")

    def test_piped_input_is_rejected_before_prompt_or_private_write(self):
        result = subprocess.run([sys.executable, str(SCRIPT)], input=self.ssh_pass,
                                capture_output=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn(b"interactive terminal", result.stderr)
        self.assertNotIn(self.ssh_pass, result.stdout + result.stderr)

    def test_secret_arguments_are_rejected_and_redacted(self):
        result = subprocess.run([sys.executable, str(SCRIPT), self.api_pass.decode()],
                                capture_output=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(self.api_pass, result.stdout + result.stderr)

    def test_mismatch_stops_once_without_echoing_values(self):
        with patch.object(sys.stdin, "isatty", return_value=True), \
             patch.object(sys.stdout, "isatty", return_value=True), \
             patch.object(ceremony.getpass, "getpass", side_effect=[self.ssh_pass.decode(), self.api_pass.decode()]) as prompt:
            with self.assertRaises(ceremony.KeySafetyError):
                ceremony.prompt_twice("SSH")
            self.assertEqual(prompt.call_count, 2)

    def test_real_terminal_prompt_disables_echo(self):
        master, slave = pty.openpty()
        code = ("import runpy; m=runpy.run_path(" + repr(str(SCRIPT)) + "); "
                "m['prompt_twice']('Mock SSH'); print('MOCK_PROMPT_PASS', flush=True)")
        process = subprocess.Popen([sys.executable, "-c", code], stdin=slave, stdout=slave, stderr=slave,
                                   start_new_session=True)
        transcript = b""
        try:
            deadline = time.monotonic() + 10
            entries = 0
            while time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], 0.1)
                if ready:
                    transcript += os.read(master, 4096)
                if transcript.count(b"(hidden): ") > entries:
                    self.assertEqual(termios.tcgetattr(slave)[3] & termios.ECHO, 0)
                    os.write(master, self.ssh_pass + b"\n")  # Mock value only; never owner input.
                    entries += 1
                if b"MOCK_PROMPT_PASS" in transcript:
                    break
                if process.poll() is not None:
                    break
            self.assertEqual(entries, 2)
            self.assertIn(b"MOCK_PROMPT_PASS", transcript)
            self.assertNotIn(self.ssh_pass, transcript)
            self.assertEqual(process.wait(timeout=2), 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=2)
            os.close(master)
            os.close(slave)

    def test_unexpected_failure_does_not_log_raw_exception(self):
        output = io.StringIO()
        with patch.object(sys, "argv", [str(SCRIPT)]), \
             patch.object(sys.stdin, "isatty", return_value=True), \
             patch.object(sys.stdout, "isatty", return_value=True), \
             patch.object(ceremony.resource, "setrlimit", side_effect=RuntimeError(self.api_pass.decode())), \
             contextlib.redirect_stderr(output):
            self.assertEqual(ceremony.main(), 1)
        self.assertNotIn(self.api_pass.decode(), output.getvalue())
        self.assertNotIn("Traceback", output.getvalue())


if __name__ == "__main__":
    unittest.main()
