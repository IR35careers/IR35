import json
import ast
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock,patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import auth_retry
import auth_redaction as safe
import auth_diagnostic


class AuthRetryTests(unittest.TestCase):
    def test_no_secret_or_vendor_text_can_escape_diagnostics(self):
        rid='00000000-0000-0000-0000-000000000012'
        secret='private_secret_canary'
        body=json.dumps({'error_code':secret,'error':secret,'msg':'email@test.invalid '+secret,
            'request_id':rid,'password':secret,'access_token':secret,'hash':'$2b$'+secret}).encode()
        value=safe.response_diagnostic(400,body,{},rid)
        self.assertNotIn(secret,json.dumps(value));self.assertNotIn('email@test.invalid',json.dumps(value))
        self.assertEqual(value['requestId'],rid)
        self.assertEqual(value['requestIdFromBody'],rid)
        self.assertEqual(safe.response_diagnostic(400,b'{bad',{},rid)['error_code'],None)
        valid=safe.response_diagnostic(400,b'{"error_code":"invalid_credentials","msg":"Invalid login credentials"}',{},rid)
        self.assertEqual(valid['error_code'],'invalid_credentials');self.assertEqual(valid['msg'],'Invalid login credentials')

    def test_logs_only_include_correlated_projected_fields(self):
        rid='00000000-0000-0000-0000-000000000012'
        raw=json.dumps({'request_id':rid,'msg':'secret','error':'secret','password':'secret','status':400,'method':'POST','path':'/token'})+'\n'+json.dumps({'request_id':'other','msg':'Request completed'})
        logs=safe.correlated_logs(raw,rid)
        self.assertEqual(len(logs),1);self.assertNotIn('secret',json.dumps(logs));self.assertEqual(logs[0]['status'],400)

    def test_all_guest_modes_compile_and_no_credentials_in_prepare(self):
        with patch.object(auth_retry.schema,'guest_bundle',return_value=''):
            for mode in ('status','prepare','login'):
                source=auth_retry.guest(mode,'secret-fixture' if mode=='login' else '')
                compile(source,'staging-attempt2-'+mode,'exec')
                self.assertNotIn('ALTER ROLE',source)
                self.assertNotIn('DROP DATABASE',source)
                self.assertNotIn('UPDATE auth.users',source)
                if mode=='prepare':
                    self.assertNotIn('grant_type=password',source)
                    self.assertNotIn('secret-fixture',source)
                if mode=='login':
                    self.assertIn('/auth/v1/token?grant_type=password',source)
                    self.assertIn("'apikey':values['ANON_KEY']",source)
                    self.assertIn('globalPasswordAttempts=2',source)
                    self.assertIn('correlated_logs',source)
                    self.assertIn('Cross-owner RLS negative failed',source)
                    self.assertIn('finally:',source)
                    self.assertIn('stop_all()',source)

    def test_no_password_read_after_second_denial(self):
        stream=Mock()
        with patch.object(Path,'exists',return_value=False),patch.object(sys,'argv',['auth_retry.py','--stdin-secret']),patch.object(sys,'stdin',stream),patch.object(auth_retry,'get_status',return_value={'status':'LOGIN_DENIED'}),patch.object(auth_retry.schema,'run_guest') as remote:
            with self.assertRaisesRegex(ValueError,'Not ready'):auth_retry.main()
        stream.read.assert_not_called();remote.assert_not_called()

    def test_integrity_hold_blocks_every_mode_before_ssh_or_stdin(self):
        for mode in ('--status','--prepare','--stdin-secret'):
            stream=Mock()
            with patch.object(Path,'exists',return_value=True),patch.object(sys,'argv',['auth_retry.py',mode]),patch.object(sys,'stdin',stream),patch.object(auth_retry,'get_status') as state,patch.object(auth_retry.schema,'run_guest') as remote:
                with self.assertRaisesRegex(ValueError,'Source reference integrity hold'):auth_retry.main()
            stream.read.assert_not_called();state.assert_not_called();remote.assert_not_called()

    def test_journal_destination_cannot_be_redirected_by_audit_globals(self):
        # Actual save() AST, with the exact collision that caused the incident.
        tree=ast.parse(auth_retry.COMMON)
        fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='save')
        write=Mock();root=Path('/synthetic-ir35')
        scope={'ROOT':root,'path':root/'.env.p4-cycle1-source.json','record':{'status':'fixture'},'write':write,'json':json}
        exec(compile(ast.Module(body=[fn],type_ignores=[]),'journal-regression','exec'),scope)
        scope['save']()
        self.assertEqual(write.call_args.args[0],root/'config/p4-auth-authorized-2.json')
        with patch.object(auth_retry.schema,'guest_bundle',return_value=''):
            source=auth_retry.guest('prepare')
        self.assertIn('audit_context=dict(globals())',source)
        parent={'path':'journal','record':{'safe':True}}
        isolated=dict(parent);exec("path='source-reference';record={'safe':False}",isolated)
        self.assertEqual(parent,{'path':'journal','record':{'safe':True}})

    def test_readonly_diagnosis_never_outputs_hash(self):
        self.assertIn('BEGIN READ ONLY',auth_diagnostic.GUEST)
        self.assertIn("if k!='passwordMD5'",auth_diagnostic.GUEST)
        self.assertNotIn('print(source)',auth_diagnostic.GUEST)
        self.assertNotIn('grant_type=password',auth_diagnostic.GUEST)


if __name__=='__main__':unittest.main()
