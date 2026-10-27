import inspect
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p8_reverse_preflight as preflight
from offline_bundle_fixture import public_bootstrap


class ReversePreflightTests(unittest.TestCase):
    def test_capability_query_contains_no_role_write_or_secret_column(self):
        for forbidden in ('ALTER ','GRANT ','REVOKE ','SET ','INSERT ','UPDATE ','DELETE ','CREATE ','rolpassword','encrypted_password'):
            self.assertNotIn(forbidden,preflight.SQL)
        for required in ('has_parameter_privilege','rolcreatedb','attgenerated','attidentity','condeferrable'):
            self.assertIn(required,preflight.SQL)
    def test_complete_program_compiles_without_private_state_or_calls(self):
        with public_bootstrap():code=preflight.program({'public':'fixture'})
        compile(code,'<public-reverse>','exec')
        source=inspect.getsource(preflight.program)
        self.assertIn('containment(data,runtime',source)
        self.assertNotIn('readonly=False',source)
        self.assertNotIn('ensure_session(',source)


if __name__=='__main__':unittest.main()
