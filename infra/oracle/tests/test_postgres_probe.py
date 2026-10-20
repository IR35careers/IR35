import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import postgres_probe_guest as guest


def config():
    pin = json.loads((Path(__file__).resolve().parents[1] / "postgres-image.json").read_text())
    return {"uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "image": pin["pinnedImage"], "extensions": pin["requiredExtensions"]}


class NativeProbeTests(unittest.TestCase):
    def test_diagnostics_classify_only_known_tokens_never_echo_sql_or_values(self):
        value = guest.diagnostic('ERROR: unrecognized configuration parameter "lc_collate"\nsecret-sentinel-do-not-echo')
        self.assertTrue(value["unknownConfiguration"])
        self.assertEqual(value["knownErrorTokens"], ["lc_collate"])
        self.assertNotIn("secret-sentinel", json.dumps(value))
    def test_input_requires_pinned_pg17_and_exact_cloud_extension_versions(self):
        self.assertEqual(guest.validate(config()), config())
        for field, value in (("image", "supabase/postgres:15"), ("uuid", "../../bad"), ("extensions", {"pgcrypto": "other"})):
            with self.assertRaises(RuntimeError):
                guest.validate({**config(), field: value})
        with self.assertRaises(RuntimeError):
            guest.validate({**config(), "password": "never-accepted"})

    def test_disposable_probe_has_no_ports_network_or_host_mounts_and_hard_limits(self):
        args = guest.create_args(config())
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertEqual(args[args.index("--memory") + 1], "3g")
        self.assertEqual(args[args.index("--user") + 1], "postgres")
        self.assertIn("--read-only", args)
        for disallowed in ("--publish", "-p", "--volume", "-v", "--privileged", "--env", "--restart"):
            self.assertNotIn(disallowed, args)
        subprocess.run(["bash", "-n"], input=guest.shell(config()), text=True, check=True)

    def test_sql_exercises_five_fixed_versions_without_source_rows_or_secret_values(self):
        text = guest.sql(config())
        for name, version in config()["extensions"].items():
            self.assertIn("('%s','%s')" % (name, version), text)
        self.assertIn("RETURNED_SQLSTATE", text)
        self.assertIn("installed_mismatch", text)
        self.assertIn("vault.decrypted_secrets", text)
        self.assertNotIn("create_secret", text)
        self.assertNotIn("ALTER EXTENSION", text)
        self.assertNotIn("auth.users", text)
        self.assertIn("SELECT datcollate FROM pg_database", text)
        self.assertNotIn("current_setting('lc_collate')", text)

    def test_repair_only_identified_failed_empty_probe_never_a_database_mount(self):
        row = {"Config": {"Image": config()["image"], "Labels": {guest.LABEL: "P3-native-arm"}, "Cmd": ["current_setting('lc_collate')"]},
            "State": {"Status": "exited", "ExitCode": 3}, "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True}, "Mounts": []}
        error = 'ERROR: unrecognized configuration parameter "lc_collate"'
        self.assertTrue(guest.repairable_empty_probe(row, config(), error))
        for field, value in (("Mounts", [{"Destination": "/var/lib/postgresql/data"}]), ("State", {"Status": "running", "ExitCode": 0})):
            self.assertFalse(guest.repairable_empty_probe({**row, field: value}, config(), error))
        changed = copy.deepcopy(row)
        changed["HostConfig"]["NetworkMode"] = "bridge"
        self.assertFalse(guest.repairable_empty_probe(changed, config(), error))
        self.assertFalse(guest.repairable_empty_probe(row, config(), "unrelated error"))


if __name__ == "__main__":
    unittest.main()
