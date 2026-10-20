import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bootstrap_audit as bootstrap
import register_api_key as registry
import unlock_api as unlock
from key_ceremony import KeySafetyError

PROFILE = {"tenancy": "ocid1.tenancy.oc1..controlledfixture01", "user": "ocid1.user.oc1..controlledfixture01",
           "region": "uk-london-1", "fingerprint": "00:" * 15 + "00", "key_file": "/mock/existing.pem"}
SAFE = {"checkedAt": "2026-10-20T00:00:00+00:00", "signedTenancyMatch": True, "activeUserMatch": True,
        "homeRegion": "uk-london-1", "regionStatus": "READY", "registeredApiKeys": 2,
        "newPublicKeyRegistered": False, "newPublicKeyState": "ABSENT", "oldPublicKeyStillRegistered": True,
        "newKeyEncryptedRoundTrip": True, "subscriptions": [{"state": "ACTIVE", "paymentModel": "FREE_TRIAL"}]}
FINGERPRINT = "11:" * 15 + "11"


class BootstrapTests(unittest.TestCase):
    def test_command_scope_rejects_extra_flags_and_mutations_before_execution(self):
        with patch.object(bootstrap, "read_profile", return_value=PROFILE), patch.object(bootstrap.subprocess, "run") as run:
            for arguments in [["iam", "user", "delete"],
                              ["iam", "tenancy", "get", "--tenancy-id", PROFILE["tenancy"], "--debug"],
                              ["compute", "instance", "launch"],
                              ["iam", "user", "api-key", "upload", "--key-file", "/mock/private.pem"]]:
                with self.assertRaises(KeySafetyError):
                    bootstrap.cli_json(Path("/mock/config"), arguments)
            with self.assertRaises(KeySafetyError):
                bootstrap.cli_json(Path("/mock/config"), ["iam", "user", "api-key", "upload"], public_key_upload=True)
            run.assert_not_called()

    def test_cli_is_bounded_has_no_retry_and_sanitizes_inherited_oci_environment(self):
        result = subprocess.CompletedProcess([], 0, '{"data":{"ok":true}}', "")
        with patch.object(bootstrap, "read_profile", return_value=PROFILE), \
             patch.dict(os.environ, {"OCI_CLI_DEBUG": "true", "OCI_CLI_PASSPHRASE": "mock-never-inherited"}), \
             patch.object(bootstrap.subprocess, "run", return_value=result) as run:
            answer = bootstrap.cli_json(Path("/mock/config"), ["iam", "user", "get", "--user-id", PROFILE["user"]])
            self.assertTrue(answer["ok"])
            args, kwargs = run.call_args
            self.assertIn("--no-retry", args[0])
            self.assertEqual(kwargs["timeout"], 65)
            self.assertFalse(any(k.startswith("OCI_") for k in kwargs["env"]))
            self.assertTrue(kwargs["capture_output"])

    def test_provider_error_redacts_body_key_values_and_credentials(self):
        secret = "mock-password-never-print-this"
        result = subprocess.CompletedProcess([], 1, secret, '{"code":"NotAuthenticated","status":401,"message":"' + secret + '"}')
        with patch.object(bootstrap, "read_profile", return_value=PROFILE), patch.object(bootstrap.subprocess, "run", return_value=result):
            with self.assertRaises(KeySafetyError) as error:
                bootstrap.cli_json(Path("/mock/config"), ["iam", "user", "get", "--user-id", PROFILE["user"]])
            self.assertIn("code=NotAuthenticated; status=401", str(error.exception))
            self.assertNotIn(secret, str(error.exception))

    def test_explicit_unlock_is_in_child_memory_only_not_arguments_or_config(self):
        secret = "mock-api-unlock-passphrase-only"
        result = subprocess.CompletedProcess([], 0, '{"data":{"ok":true}}', "")
        with patch.object(bootstrap, "read_profile", return_value=PROFILE), patch.object(bootstrap.subprocess, "run", return_value=result) as run:
            bootstrap.cli_json(Path("/mock/config"), ["iam", "user", "get", "--user-id", PROFILE["user"]], passphrase=secret)
            args, kwargs = run.call_args
            self.assertEqual(kwargs["env"]["OCI_CLI_PASSPHRASE"], secret)
            self.assertNotIn(secret, " ".join(args[0]))

    def test_even_a_passphrase_matching_an_error_code_is_redacted(self):
        result = subprocess.CompletedProcess([], 1, "", '{"code":"NotAuthenticated","status":401}')
        with patch.object(bootstrap, "read_profile", return_value=PROFILE), patch.object(bootstrap.subprocess, "run", return_value=result):
            with self.assertRaises(KeySafetyError) as error:
                bootstrap.cli_json(Path("/mock/config"), ["iam", "user", "get", "--user-id", PROFILE["user"]], passphrase="NotAuthenticated")
            self.assertNotIn("NotAuthenticated", str(error.exception))
            self.assertIn("[REDACTED]", str(error.exception))

    def test_generated_config_never_overwrites_or_follows_links(self):
        with tempfile.TemporaryDirectory(prefix="ir35-bootstrap-test-") as temp:
            home = Path(temp)
            parent = home / ".ir35/p1-tooling"
            parent.mkdir(parents=True, mode=0o700)
            with patch.object(bootstrap.Path, "home", return_value=home):
                config = bootstrap.prepare_config(PROFILE)
                self.assertEqual(config.stat().st_mode & 0o777, 0o600)
                self.assertNotIn("pass_phrase", config.read_text())
                with self.assertRaises(KeySafetyError):
                    bootstrap.prepare_config({**PROFILE, "pass_phrase": "must-never-be-written"})
                self.assertEqual(bootstrap.prepare_config(PROFILE), config)
                with self.assertRaises(KeySafetyError):
                    bootstrap.prepare_config({**PROFILE, "fingerprint": FINGERPRINT})
                self.assertIn(PROFILE["fingerprint"], config.read_text())
                config.unlink()
                target = home / "unrelated"
                target.write_text("untouched")
                config.symlink_to(target)
                with self.assertRaises(KeySafetyError):
                    bootstrap.prepare_config(PROFILE)
                self.assertEqual(target.read_text(), "untouched")

    def test_free_slot_gate_rejects_paid_unknown_and_full_accounts(self):
        registry.require_free_credential_gate(SAFE)
        changes = [{"subscriptions": []}, {"subscriptions": [{"state": "ACTIVE", "paymentModel": "PAYG"}]},
                   {"registeredApiKeys": 3}, {"registeredApiKeys": True}, {"oldPublicKeyStillRegistered": False},
                   {"newKeyEncryptedRoundTrip": False}, {"homeRegion": "elsewhere"}, {"signedTenancyMatch": False}]
        for change in changes:
            with self.assertRaises(KeySafetyError):
                registry.require_free_credential_gate({**SAFE, **change})

    def test_registration_persists_intent_before_exact_public_upload_then_reads_back(self):
        with tempfile.TemporaryDirectory(prefix="ir35-api-key-test-") as temp:
            directory = Path(temp)
            after = {**SAFE, "newPublicKeyRegistered": True, "newPublicKeyState": "ACTIVE", "registeredApiKeys": 3}
            def upload(config, arguments, **kwargs):
                self.assertTrue((directory / "api-registration-intent.json").exists())
                self.assertEqual(arguments[-1], str(directory / "oci_api_public.pem"))
                self.assertTrue(kwargs["public_key_upload"])
                return {"fingerprint": FINGERPRINT}
            with patch.object(registry, "KEY_DIRECTORY", directory), patch.object(registry, "check_public_key", return_value=FINGERPRINT), \
                 patch.object(registry, "audit", side_effect=[SAFE, after]), patch.object(registry, "read_profile", return_value=PROFILE), \
                 patch.object(registry, "prepare_config", return_value=Path("/mock/config")), \
                 patch.object(registry, "cli_json", side_effect=upload) as call, contextlib.redirect_stdout(io.StringIO()):
                receipt = registry.register()
                self.assertEqual(receipt["status"], "PUBLIC_KEY_REGISTERED")
                self.assertEqual(call.call_count, 1)
                self.assertEqual(json.loads((directory / "api-registration-intent.json").read_text())["status"], "PENDING")
                self.assertEqual(json.loads((directory / "api-registration-receipt.json").read_text()), receipt)

    def test_unknown_upload_outcome_cannot_be_blindly_retried(self):
        with tempfile.TemporaryDirectory(prefix="ir35-api-key-test-") as temp:
            directory = Path(temp)
            with patch.object(registry, "KEY_DIRECTORY", directory), patch.object(registry, "check_public_key", return_value=FINGERPRINT), \
                 patch.object(registry, "audit", return_value=SAFE), patch.object(registry, "read_profile", return_value=PROFILE), \
                 patch.object(registry, "prepare_config", return_value=Path("/mock/config")), \
                 patch.object(registry, "cli_json", side_effect=TimeoutError("mock-secret-suppressed")) as call, \
                 contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(TimeoutError):
                    registry.register()
                with self.assertRaises(KeySafetyError):
                    registry.register()
                self.assertEqual(call.call_count, 1)
                self.assertFalse((directory / "api-registration-receipt.json").exists())

    def test_existing_active_key_is_reconciled_without_another_create(self):
        after = {**SAFE, "newPublicKeyRegistered": True, "newPublicKeyState": "ACTIVE", "registeredApiKeys": 3}
        with patch.object(registry, "check_public_key", return_value=FINGERPRINT), patch.object(registry, "audit", return_value=after), \
             patch.object(registry, "cli_json") as call:
            self.assertEqual(registry.register()["status"], "PUBLIC_KEY_PRESENT")
            call.assert_not_called()

    def test_wrong_unlock_never_calls_oracle_or_writes_a_receipt(self):
        from key_ceremony import create_keys
        with tempfile.TemporaryDirectory(prefix="ir35-unlock-test-") as temp:
            parent = Path(temp)
            parent.chmod(0o700)
            directory = parent / "keys"
            create_keys(directory, b"mock-ssh-passphrase-only", b"mock-api-passphrase-only")
            with patch.object(unlock, "KEY_DIRECTORY", directory), patch.object(unlock, "audit") as audit:
                with self.assertRaises(KeySafetyError) as error:
                    unlock.unlock_and_verify("wrong-mock-passphrase")
                self.assertNotIn("wrong-mock-passphrase", str(error.exception))
                audit.assert_not_called()
                self.assertFalse((directory / "api-authentication-status.json").exists())

    def test_unlock_success_receipt_has_only_redacted_metadata(self):
        from key_ceremony import create_keys
        with tempfile.TemporaryDirectory(prefix="ir35-unlock-test-") as temp:
            parent = Path(temp)
            parent.chmod(0o700)
            directory = parent / "keys"
            create_keys(directory, b"mock-ssh-passphrase-only", b"mock-api-passphrase-only")
            after = {**SAFE, "newPublicKeyRegistered": True, "newPublicKeyState": "ACTIVE", "registeredApiKeys": 3}
            with patch.object(unlock, "KEY_DIRECTORY", directory), patch.object(unlock, "audit", return_value=after) as audit, \
                 patch.object(unlock, "read_profile", return_value=PROFILE):
                report = unlock.unlock_and_verify("mock-api-passphrase-only")
                self.assertEqual(report["status"], "NEW_ENCRYPTED_API_AUTHENTICATION_PASS")
                self.assertEqual(audit.call_count, 1)
                self.assertNotIn("mock-api-passphrase-only", json.dumps(report))
                self.assertEqual((directory / "api-authentication-status.json").stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
