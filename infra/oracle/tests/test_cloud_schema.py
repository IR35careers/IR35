import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import cloud_schema as schema


def environment():
    return {"PGHOST":"aws-1-eu-west-2.pooler.supabase.com","PGPORT":"5432","PGUSER":"fixture.kxcbgflleqnjzjbkevwd","PGPASSWORD":"private-password-sentinel",
        "PGDATABASE":"postgres","PGSSLMODE":"verify-full","PGSSLROOTCERT":"/mnt/c/Users/anves/.codex/operations/ir35careers/supabase-prod-ca-2021.crt",
        "PGOPTIONS":"-c default_transaction_read_only=on -c statement_timeout=300000 -c lock_timeout=5000"}


class CloudSchemaTests(unittest.TestCase):
    def test_source_identity_tls_and_readonly_are_mandatory(self):
        with patch.dict(os.environ,environment(),clear=True):
            self.assertEqual(schema.source_environment()["PGSSLMODE"],"verify-full")
            for key,value in (("PGHOST","unapproved.example"),("PGPORT","6543"),("PGSSLMODE","require"),("PGOPTIONS",""),("PGSERVICE","other")):
                with patch.dict(os.environ,{key:value}):
                    with self.assertRaises(schema.KeySafetyError):
                        schema.source_environment()

    def test_native_errors_never_echo_credentials_or_raw_output(self):
        error=subprocess.CompletedProcess([],1,b"private-password-sentinel",b"ERROR: 42501 private-password-sentinel")
        with patch.object(schema.subprocess,"run",return_value=error) as run:
            with self.assertRaises(schema.KeySafetyError) as observed:
                schema.native("pg_dump",["--schema-only"],environment())
        self.assertNotIn("private-password-sentinel",str(observed.exception))
        self.assertNotIn("private-password-sentinel"," ".join(run.call_args.args[0]))
        self.assertIn("42501",str(observed.exception))

    def test_receiver_only_allows_protected_env_artifacts_and_no_restore(self):
        self.assertIn("promotedToProduction",schema.RECEIVE)
        self.assertIn("os.O_EXCL|os.O_NOFOLLOW",schema.RECEIVE)
        self.assertIn("0o600",schema.RECEIVE)
        self.assertIn("1002,1002",schema.RECEIVE)
        self.assertNotIn("pg_restore",schema.RECEIVE)
        self.assertNotIn("DROP",schema.RECEIVE)

    def test_pooler_backend_ssl_is_not_confused_with_verified_client_tls(self):
        source=Path(schema.__file__).read_text()
        self.assertIn('b"SSL connection" in connection',source)
        self.assertIn('"clientVerifiedTLS":client_tls',source)
        self.assertNotIn('preflight.get("ssl") is not True',source)

    def test_clone_is_schema_only_fixed_unattached_database_and_no_broad_missing_roles(self):
        self.assertIn("ir35_cloud_baseline_20261021",schema.CLONE)
        self.assertIn("Unowned clone database collision",schema.CLONE)
        self.assertIn("'--single-transaction','--exit-on-error'",schema.CLONE)
        self.assertIn("Missing privileged role requires review",schema.CLONE)
        self.assertIn("PASSWORD NULL",schema.CLONE)
        self.assertIn("Ambiguous clone restore; reconcile",schema.CLONE)
        self.assertNotIn("DROP DATABASE",schema.CLONE)
        self.assertNotIn("APPLICATION_WORKER_ACCEPT_JOBS=true",schema.CLONE)
        compile(schema.CLONE,"reviewed-clone-guest","exec")


if __name__=="__main__":
    unittest.main()
