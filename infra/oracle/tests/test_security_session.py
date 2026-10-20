import json
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import security_session as session
from key_ceremony import KeySafetyError


class SecuritySessionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        os.chmod(self.root, 0o700)
        self.receipt = self.root / "receipt.json"
        session.write_new(self.receipt, json.dumps({"browserAuthenticatedAt": 1000}).encode())
        self.profile = {"tenancy": "mock-tenancy", "user": "mock-user", "expiresAt": 3000}
        for name, value in (("ROOT", self.root), ("RECEIPT", self.receipt)):
            item = patch.object(session, name, value)
            item.start()
            self.addCleanup(item.stop)

    def test_token_profile_is_mandatory_no_api_or_environment_fallback(self):
        args = session.command(["session", "refresh"])
        self.assertEqual(args[args.index("--profile") + 1], "ir35")
        self.assertEqual(args[args.index("--auth") + 1], "security_token")
        with patch.dict(os.environ, {"OCI_CLI_PASSPHRASE": "secret-sentinel", "OCI_CLI_AUTH": "api_key"}):
            self.assertFalse(any(key.startswith("OCI_") for key in session.clean_environment()))

    def test_fresh_session_needs_no_refresh(self):
        with patch.object(session, "session_profile", return_value=self.profile), patch.object(session.subprocess, "run") as run:
            self.assertEqual(session.ensure_session(now=2000)["user"], "mock-user")
            run.assert_not_called()

    def test_refresh_before_expiry_preserves_original_daily_deadline(self):
        with patch.object(session, "session_profile", side_effect=[{**self.profile, "expiresAt": 2500}, self.profile]), \
                patch.object(session.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            session.ensure_session(now=2000)
            self.assertEqual(run.call_args.args[0][-2:], ["session", "refresh"])
            self.assertEqual(json.loads(self.receipt.read_text())["browserAuthenticatedAt"], 1000)

    def test_failed_refresh_is_one_redacted_browser_gate_not_api_prompt(self):
        with patch.object(session, "session_profile", return_value={**self.profile, "expiresAt": 2100}), \
                patch.object(session.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "secret-sentinel", "secret-sentinel")) as run:
            with self.assertRaises(KeySafetyError) as error:
                session.ensure_session(now=2000)
            self.assertIn("browser sign-in required", str(error.exception))
            self.assertNotIn("secret-sentinel", str(error.exception))
            self.assertEqual(run.call_count, 1)

    def test_daily_gate_never_extends_by_refresh(self):
        with patch.object(session, "session_profile") as profile, patch.object(session.subprocess, "run") as run:
            with self.assertRaises(KeySafetyError):
                session.ensure_session(now=87400)
            profile.assert_not_called()
            run.assert_not_called()

    def test_unsafe_permissions_or_symlinks_are_rejected(self):
        os.chmod(self.receipt, 0o644)
        with self.assertRaises(KeySafetyError):
            session.private_file(self.receipt)
        link = self.root / "link"
        link.symlink_to(self.receipt)
        with self.assertRaises(KeySafetyError):
            session.private_file(link)

    def test_browser_request_only_goes_to_private_parent_pipe(self):
        url = "https://login.uk-london-1.oraclecloud.com/v1/oauth2/authorize?public_key=public-test"
        pipe = io.StringIO()
        with patch.dict(os.environ, {"IR35_BROWSER_BRIDGE_PIPE": "1"}), patch.object(session.sys, "__stdout__", pipe):
            self.assertTrue(session.WindowsBrowser().open(url))
            self.assertEqual(pipe.getvalue(), "IR35_BROWSER_REQUEST " + url + "\n")
            with self.assertRaises(KeySafetyError):
                session.WindowsBrowser().open("https://example.invalid/login")
        with patch.dict(os.environ, {"IR35_BROWSER_BRIDGE_PIPE": "0"}):
            with self.assertRaises(KeySafetyError):
                session.WindowsBrowser().open(url)


if __name__ == "__main__":
    unittest.main()
