import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import staging_stack as stack
import stack_guest as guest


class StagingStackTests(unittest.TestCase):
    def setUp(self):
        self.images = json.loads((Path(stack.__file__).parent / "staging-images.json").read_text())["images"]

    def test_slim_compose_pins_arm_limits_and_only_caddy_public_ports(self):
        doc = stack.compose(self.images)
        self.assertEqual(set(doc["services"]), {"db", "auth", "rest", "realtime", "storage", "kong", "meta", "caddy", "smtp", "studio"})
        for name, service in doc["services"].items():
            self.assertIn("@sha256:", service["image"])
            self.assertEqual(service["platform"], "linux/arm64")
            self.assertIn("mem_limit", service)
            self.assertEqual(service["restart"], "no")
            self.assertNotIn("env_file", service)
            self.assertEqual(service["entrypoint"][:2], ["/run/ir35/env-exec", "/opt/ir35/.env." + name])
            self.assertIn("/opt/ir35/.env." + name + ":/opt/ir35/.env." + name + ":ro", service["volumes"])
            if name not in ("caddy", "studio"):
                self.assertNotIn("ports", service)
            if name != "caddy":
                self.assertEqual(service["logging"], {"driver": "none"})
        self.assertEqual(doc["services"]["caddy"]["ports"], ["80:80/tcp", "443:443/tcp"])
        self.assertEqual(doc["services"]["studio"]["profiles"], ["studio"])
        self.assertTrue(all(port.startswith("127.0.0.1:") for port in doc["services"]["studio"]["ports"]))
        self.assertTrue(doc["networks"]["backend"]["internal"])
        self.assertEqual(doc["services"]["smtp"]["networks"], ["backend"])
        self.assertNotIn("imgproxy", str(doc["services"]["storage"]))

    def test_keys_stay_in_env_and_caddy_state_only_no_named_key_volume(self):
        doc = stack.compose(self.images)
        self.assertNotIn("volumes", doc)
        self.assertNotIn("pgsodium_root.key", json.dumps(doc))
        self.assertIn("PGSODIUM_ROOT_KEY", stack.GETKEY)
        self.assertNotIn(">", stack.GETKEY)
        subprocess.run(["sh", "-n"], input=stack.GETKEY, text=True, check=True)
        self.assertIn("persist_config off", stack.CADDYFILE)
        self.assertIn("disable_tlsalpn_challenge", stack.CADDYFILE)
        self.assertIn('X-Robots-Tag "noindex', stack.CADDYFILE)
        self.assertIn("basic_auth", stack.CADDYFILE)
        self.assertIn("not remote_ip", stack.CADDYFILE)
        self.assertNotIn("log_append", stack.CADDYFILE)

    def test_gateway_preserves_bearer_and_exposes_no_studio_meta_or_functions(self):
        config = stack.kong_config("fixture-anon", "fixture-service")
        paths = [path for service in config["services"] for route in service["routes"] for path in route["paths"]]
        self.assertNotIn("/", paths)
        self.assertFalse(any(path.startswith(("/pg", "/mcp", "/functions", "/graphql")) for path in paths))
        self.assertIn("headers.authorization", json.dumps(config))
        storage = next(service for service in config["services"] if service["name"] == "storage-v1")
        self.assertFalse(any(plugin["name"] == "key-auth" for plugin in storage["plugins"]))

    def test_component_secrets_are_separate_mock_and_smtp_sink_enforced(self):
        values = {key: "fixture-value" for key in ("POSTGRES_PASSWORD", "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY", "PGSODIUM_ROOT_KEY", "REALTIME_DB_ENC_KEY", "SECRET_KEY_BASE", "PG_META_CRYPTO_KEY", "STAGING_BASIC_HASH", "STAGING_OWNER_IP")}
        environments = guest.component_env(values)
        self.assertEqual(environments["auth"]["GOTRUE_SMTP_HOST"], "smtp")
        self.assertEqual(environments["auth"]["GOTRUE_SMTP_PORT"], "1025")
        self.assertEqual(environments["auth"]["GOTRUE_DISABLE_SIGNUP"], "true")
        self.assertNotIn("GOTRUE_EXTERNAL_GOOGLE_SECRET", environments["auth"])
        self.assertNotIn("POSTGRES_PASSWORD", environments["caddy"])
        self.assertNotIn("JWT_SECRET", environments["smtp"])
        self.assertEqual(guest.env_text({"SENTINEL": "$fixture"}), "SENTINEL='$fixture'\n")
        with self.assertRaises(RuntimeError):
            guest.env_text({"UNSAFE": "value'break"})

    def test_no_credentials_or_unapproved_host_in_untrusted_ca_probe(self):
        with patch.object(guest.socket, "create_connection") as connection:
            with self.assertRaisesRegex(RuntimeError, "Never send credentials"):
                guest.tls_request("staging.ir35careers.com", "/", False, {"Authorization": "fixture-never-send"})
            with self.assertRaisesRegex(RuntimeError, "Staging hosts only"):
                guest.tls_request("www.ir35careers.com", "/", True)
            connection.assert_not_called()

    def test_password_hashing_requires_attached_stdin_never_plaintext_argument(self):
        args = guest.hash_password_args(self.images["caddy"]["image"])
        self.assertIn("-i", args)
        self.assertIn("--network", args)
        self.assertNotIn("--plaintext", args)
        self.assertNotIn("-p", args)

    def test_error_classification_never_exports_raw_credential_messages(self):
        report = guest.classify_error('migration SQLSTATE 42501 /app secret-value-not-for-report')
        self.assertEqual(report["sqlstates"], ["42501"])
        self.assertIn("migration", report["classes"])
        self.assertNotIn("secret-value", json.dumps(report))

    def test_generated_compose_matches_current_reviewed_builder(self):
        actual = json.loads((Path(stack.__file__).parent / "staging-compose.yml").read_text())
        self.assertEqual(actual, stack.compose(self.images))


if __name__ == "__main__":
    unittest.main()
