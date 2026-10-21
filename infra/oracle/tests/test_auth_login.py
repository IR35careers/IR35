from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import auth_login


class LoginTests(unittest.TestCase):
    def test_hidden_stdin_only_and_only_named_isolated_account(self):
        with patch.object(auth_login.schema,'guest_bundle',return_value=''):
            code=auth_login.guest('private-test-fixture',{'image':'fixture@sha256:'+'a'*64,'entrypoint':[],'command':['auth']})
        compile(code,'private-staging-login','exec')
        self.assertIn('ir35_storage_compat_a_20261021',code)
        self.assertIn('anvesh.mannuru+ir35test@gmail.com',code)
        self.assertIn('never replay a credential attempt',code)
        self.assertIn('prelogin.get',code)
        self.assertIn('Auth startup changed snapshot data/schema',code)
        self.assertIn('logout?scope=local',code)
        self.assertIn('SMTP sink required',auth_login.START)
        self.assertNotIn('--password',code)
        self.assertNotIn('DROP DATABASE',code)
        self.assertNotIn('ALTER ROLE',auth_login.START)
        self.assertIn('private-test-fixture',code) # Only SSH stdin script, never process arguments.
        self.assertNotIn('print(reply)',code)
        self.assertNotIn('print(token)',code)
        with patch.object(auth_login.schema,'guest_bundle',return_value=''):
            prepared=auth_login.guest('',{'image':'fixture','entrypoint':[],'command':['auth']},prepare=True)
        compile(prepared,'auth-preparation','exec')
        self.assertIn('Auth login attempt already journalled',prepared)
        self.assertIn('READY_STOPPED',prepared)
        self.assertIn('passwordRequested',prepared)
        self.assertNotIn('grant_type=password',prepared)

    def test_token_verification_precedes_success_and_no_production_host(self):
        self.assertIn('hmac.compare_digest',auth_login.FINISH)
        self.assertIn('test_ids!=[claims.get',auth_login.FINISH)
        self.assertNotIn('supabase.co',auth_login.START+auth_login.FINISH)
        self.assertNotIn('https://www.ir35careers.com',auth_login.START+auth_login.FINISH)


if __name__=='__main__':unittest.main()
