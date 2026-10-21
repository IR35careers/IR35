from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import acl_runtime_audit as audit


class AclRuntimeAuditTests(unittest.TestCase):
    def test_runtime_proofs_are_read_only_derived_and_secret_free(self):
        compile(audit.GUEST,'read-only-runtime-audit','exec')
        self.assertIn("uri.path!='/postgres'",audit.GUEST)
        self.assertIn("components['auth'].get('GOTRUE_SMTP_HOST')=='smtp'",audit.GUEST)
        self.assertIn('mounted.st_ino',audit.GUEST)
        self.assertIn('ssl.create_default_context()',audit.GUEST)
        self.assertIn("row['health'] not in ('','healthy')",audit.GUEST)
        self.assertNotIn('write_text',audit.GUEST)
        self.assertNotIn("'Config'",audit.GUEST)
        self.assertNotIn('print(data)',audit.GUEST)


if __name__=='__main__':unittest.main()
