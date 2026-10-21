import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import staging_stack as stack
import stack_guest as guest
import p3_stack as controller


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
        self.assertEqual(doc["services"]["rest"]["healthcheck"]["test"][:3], ["CMD", "/run/ir35/env-exec", "/opt/ir35/.env.rest"])
        self.assertEqual(doc["services"]["kong"]["healthcheck"]["test"][:3], ["CMD", "/run/ir35/env-exec", "/opt/ir35/.env.kong"])
        self.assertFalse(any(mount.startswith("/usr/local/kong:") for mount in doc["services"]["kong"]["tmpfs"]))

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
        self.assertEqual(stack.CADDYFILE.count("basic_auth {"), 2)
        self.assertIn("request_header -X-Staging-Authorization", stack.CADDYFILE)
        self.assertIn("vars @bearer original_auth", stack.CADDYFILE)
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
        self.assertEqual(environments["rest"]["PGRST_SERVER_HOST"], "0.0.0.0")
        self.assertEqual(environments["kong"]["KONG_PREFIX"], "/run/kong")
        self.assertEqual(environments["realtime"]["ERL_CRASH_DUMP_SECONDS"], "0")
        self.assertEqual(environments["realtime"]["ERL_CRASH_DUMP_BYTES"], "0")
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

    def test_bootstrap_diagnostic_reads_public_images_not_service_state(self):
        with patch.object(guest, "run", return_value="public image code") as run:
            result = guest.diagnose_bootstrap({"images": self.images})
        self.assertEqual(result["secretMounts"], 0)
        self.assertEqual(result["serviceRestarts"], 0)
        for call in run.call_args_list:
            args = call.args[0]
            self.assertEqual(args[:3], ["docker", "run", "--rm"])
            self.assertIn("none", args)
            self.assertIn("--read-only", args)
            self.assertNotIn("--env", args)
            self.assertNotIn("--volume", args)
            self.assertNotIn("--mount", args)

    def test_omitted_webhooks_role_precedes_upstream_password_script(self):
        mounts = stack.compose(self.images)["services"]["db"]["volumes"]
        self.assertTrue(any("init-scripts/98-functions-role.sql:ro" in value for value in mounts))
        self.assertIn("IF NOT EXISTS", stack.FUNCTIONS_ROLE_SQL)
        self.assertIn("NOINHERIT CREATEROLE LOGIN NOREPLICATION", stack.FUNCTIONS_ROLE_SQL)
        self.assertNotIn("CREATE EXTENSION", stack.FUNCTIONS_ROLE_SQL)

    def test_bootstrap_sql_credentials_are_stdin_only_errors_redacted(self):
        failed = subprocess.CompletedProcess([], 1, "", "ERROR: 42501 private-password-sentinel")
        with patch.object(guest, "read_env", return_value={"POSTGRES_PASSWORD": "private-password-sentinel"}), patch.object(guest.subprocess, "run", return_value=failed) as run:
            with self.assertRaisesRegex(RuntimeError, "SQLSTATE=42501") as error:
                guest.psql("SELECT 'private-password-sentinel';")
        self.assertNotIn("private-password-sentinel", str(error.exception))
        self.assertNotIn("private-password-sentinel", " ".join(run.call_args.args[0]))
        self.assertIn("private-password-sentinel", run.call_args.kwargs["input"])

    def test_bootstrap_refuses_copied_or_promoted_data_before_commands(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state.json"
            for flag in ("dataRehearsalStarted", "promotedToProduction"):
                state.write_text(json.dumps({"purpose": "ir35-disposable-staging", flag: True}))
                with patch.object(guest, "STATE", state), patch.object(guest, "dc") as dc:
                    with self.assertRaisesRegex(RuntimeError, "copied/promoted"):
                        guest.assert_empty_staging()
                    dc.assert_not_called()

    def test_bootstrap_refuses_any_customer_row(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state.json"
            state.write_text(json.dumps({"purpose": "ir35-disposable-staging"}))
            row = [{"State": {"Running": False}, "Config": {"Labels": {"com.docker.compose.project": "ir35-staging"}}}]
            with patch.object(guest, "STATE", state), patch.object(guest, "dc", return_value="fixture-container"), patch.object(guest, "run", return_value=json.dumps(row)), patch.object(guest, "psql", side_effect=['[["auth","users"]]', "1"]):
                with self.assertRaisesRegex(RuntimeError, "Customer rows present"):
                    guest.assert_empty_staging()

    def test_kong_diagnostic_redacts_private_values_and_encoded_variants(self):
        import base64
        value = "never-export-this-private-value"
        text = value + " " + base64.b64encode(value.encode()).decode() + " postgres://u:other-secret@db/postgres"
        report = json.dumps(guest.sanitized_kong_error(text, {"JWT_SECRET": value}))
        self.assertNotIn(value, report)
        self.assertNotIn(base64.b64encode(value.encode()).decode(), report)
        self.assertNotIn("other-secret", report)

    def test_caddy_adaptation_never_logs_private_bcrypt_json(self):
        fixture = {"admin": {"disabled": True, "config": {"persist": False}}, "fixture": "acme-staging-v02.api.letsencrypt.org/directory http_basic noindex, nofollow, noarchive"}
        with patch.object(guest, "write"), patch.object(guest, "run", return_value=json.dumps(fixture)) as run:
            result = guest.validate_caddy({"images": self.images})
        args = run.call_args.args[0]
        self.assertIn("--log-driver", args)
        self.assertEqual(args[args.index("--log-driver") + 1], "none")
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertEqual(result["certificateRequests"], 0)

    def test_repository_migration_order_includes_legacy_waitlist_prerequisite(self):
        sources = controller.repo_migrations()
        self.assertEqual(len(sources), 25)
        self.assertEqual(list(sources)[0], "supabase/waitlist.sql")
        self.assertEqual(list(sources)[1], "supabase/migrations/001_jobs_schema.sql")
        self.assertEqual(list(sources)[-1], "supabase/migrations/025_application_delivery_lifecycle.sql")

    def test_repository_migrations_refuse_customer_rows_and_unowned_schema(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state.json"
            state.write_text(json.dumps({"purpose": "ir35-disposable-staging"}))
            with patch.object(guest, "STATE", state), patch.object(guest, "read_env"), patch.object(guest, "psql", return_value="1"), patch.object(guest, "write") as write:
                with self.assertRaisesRegex(RuntimeError, "customer rows"):
                    guest.app_migrations({})
                write.assert_not_called()

    def test_psql_rejects_arbitrary_migration_identity(self):
        with patch.object(guest.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "Fixed staging migration roles"):
                guest.psql("SELECT 1", role="other")
            run.assert_not_called()

    def test_unchanged_protected_file_keeps_bind_mount_inode(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / ".env.fixture"
            guest.write(path, "PUBLIC_FIXTURE='test'\n", 0o600, os.geteuid())
            inode = path.stat().st_ino
            guest.write(path, "PUBLIC_FIXTURE='test'\n", 0o600, os.geteuid())
            self.assertEqual(path.stat().st_ino, inode)
            self.assertEqual(path.stat().st_nlink, 1)

    def test_exited_realtime_has_no_ip_or_network_probe(self):
        with patch.object(guest.urllib.request, "urlopen") as request:
            result = guest.realtime_probe({"State": {"Running": False}, "NetworkSettings": {"Networks": {}}}, {})
        self.assertEqual(result, {"statusCode": 0, "transportUnavailable": True})
        request.assert_not_called()

    def test_schema_gate_refuses_incomplete_or_promoted_target_before_query(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state.json"
            for record in ({"purpose": "ir35-disposable-staging", "appMigrations": {}}, {"purpose": "ir35-disposable-staging", "promotedToProduction": True}):
                state.write_text(json.dumps(record))
                with patch.object(guest, "STATE", state), patch.object(stack, "APP_MIGRATIONS", {"fixture.sql": "SELECT 1;"}, create=True), patch.object(guest, "psql") as query:
                    with self.assertRaises(RuntimeError):
                        guest.schema_gate({})
                    query.assert_not_called()

    def test_schema_gate_retrieves_readonly_catalog_without_claiming_parity(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state.json"
            state.write_text(json.dumps({"purpose": "ir35-disposable-staging", "appMigrations": {"fixture.sql": {"status": "PASS"}}}))
            sql = (controller.REPO / "supabase/verification/oracle_p3_schema_gate.sql").read_text()
            self.assertIn("REPEATABLE READ READ ONLY", sql)
            self.assertTrue(sql.rstrip().endswith("ROLLBACK;"))
            with patch.object(guest, "STATE", state), patch.object(stack, "APP_MIGRATIONS", {"fixture.sql": "SELECT 1;"}, create=True), patch.object(stack, "SCHEMA_GATE_SQL", sql, create=True), patch.object(guest, "psql", return_value='{"objects": []}') as query:
                result = guest.schema_gate({})
            query.assert_called_once_with(sql, transaction=False)
            self.assertFalse(result["parityVerified"])
            self.assertTrue(result["readOnly"])

    def test_failed_schema_report_blocks_further_vm_operations_locally(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reports = root / "docs/evidence"
            reports.mkdir(parents=True)
            with patch.object(controller, "REPO", root):
                controller.assert_schema_not_failed()
                for status in ("FAIL", "unknown"):
                    (reports / "oracle-p3-schema-gate.json").write_text(json.dumps({"status": status}))
                    with self.assertRaisesRegex(controller.KeySafetyError, "owner baseline/order"):
                        controller.assert_schema_not_failed()
                (reports / "oracle-p3-schema-gate.json").write_text('{"status":"SUBSET_MATCH_ONLY"}')
                controller.assert_schema_not_failed()


if __name__ == "__main__":
    unittest.main()
