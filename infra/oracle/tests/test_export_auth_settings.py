import ast
from contextlib import redirect_stdout
import getpass
import hashlib
import inspect
from io import StringIO
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import export_auth_settings as exporter

TOKEN='sbp_fixture_only_never_a_real_token'


class Response:
    status=200
    def __init__(self,value,url=exporter.ENDPOINT):self.body=json.dumps(value).encode();self.url=url
    def geturl(self):return self.url
    def read(self,maximum):return self.body[:maximum]
    def __enter__(self):return self
    def __exit__(self,*args):pass


class ExportAuthSettingsTests(unittest.TestCase):
    def test_explicit_allowlist_excludes_credentials_jwt_hook_secrets_and_unknown_fields(self):
        payload={'site_url':'https://www.example.invalid','external_google_client_id':'public-client',
            'external_google_enabled':True,'smtp_host':'smtp.example.invalid','smtp_port':'587',
            'mailer_templates_recovery_content':'<a href="{{ .ConfirmationURL }}">Recover</a>'}
        banned=('jwt_exp','jwt_secret','jwt_keys','smtp_pass','smtp_user','external_google_secret',
            'hook_send_email_secrets','hook_send_email_uri','unknown_key','another_secret','another_pass')
        payload.update({name:'PRIVATE_FIXTURE_DO_NOT_EXPORT' for name in banned})
        result=exporter.project(payload,TOKEN);settings=result['settings']
        self.assertEqual(set(settings),set(exporter.ALLOWLIST))
        self.assertTrue(settings['external_google_enabled'])
        self.assertEqual(settings['external_google_client_id'],'public-client')
        self.assertEqual(settings['mailer_templates_recovery_content'],payload['mailer_templates_recovery_content'])
        self.assertNotIn('PRIVATE_FIXTURE_DO_NOT_EXPORT',json.dumps(result))
        for name in settings:
            self.assertFalse(name.startswith('jwt'))
            self.assertFalse(name.endswith(('_secret','_secrets','_pass','_key')))
        for name in banned:self.assertNotIn(name,settings)
    def test_missing_wrong_type_or_nested_secret_is_null_without_defaults(self):
        result=exporter.project({'site_url':{'nested_secret':'not-exported'},'mailer_otp_length':True,
            'disable_signup':False,'sessions_timebox':0},TOKEN)
        self.assertIsNone(result['settings']['site_url']);self.assertIsNone(result['settings']['mailer_otp_length'])
        self.assertFalse(result['settings']['disable_signup']);self.assertEqual(result['settings']['sessions_timebox'],0)
        self.assertEqual(result['missing_fields'],[name for name,value in result['settings'].items() if value is None])
        self.assertNotIn('not-exported',json.dumps(result))
    def test_token_jwt_and_url_credentials_cannot_leak_through_allowlisted_content(self):
        jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.fake'
        for content in (TOKEN,jwt,'https://user:password@example.invalid'):
            result=exporter.project({'mailer_templates_confirmation_content':content},TOKEN)
            self.assertIsNone(result['settings']['mailer_templates_confirmation_content'])
            self.assertNotIn(content,json.dumps(result))
    def test_fetch_makes_exactly_one_fixed_get_no_body_no_redirect_or_proxy(self):
        observations=[];opener=Mock()
        def opened(request,timeout):
            observations.append((request.full_url,request.get_method(),request.data,timeout))
            self.assertEqual(request.get_header('Authorization'),'Bearer '+TOKEN)
            return Response({'site_url':'https://www.example.invalid'})
        opener.open.side_effect=opened
        with patch.object(exporter.urllib.request,'build_opener',return_value=opener) as build:
            result=exporter.fetch(TOKEN)
        self.assertEqual(observations,[(exporter.ENDPOINT,'GET',None,25)])
        self.assertEqual(opener.open.call_count,1)
        handlers=build.call_args.args
        self.assertEqual(handlers[0].proxies,{})
        self.assertTrue(any(isinstance(handler,exporter.NoRedirect) for handler in handlers))
        self.assertEqual(result['settings']['site_url'],'https://www.example.invalid')
        with self.assertRaises(exporter.ExportRefused):exporter.NoRedirect().redirect_request(None,None,302,'',{},'https://other.invalid')
    def test_network_failure_is_never_retried_and_response_shape_is_bounded(self):
        opener=Mock();opener.open.side_effect=RuntimeError('raw private '+TOKEN)
        with patch.object(exporter.urllib.request,'build_opener',return_value=opener):
            with self.assertRaises(RuntimeError):exporter.fetch(TOKEN)
        opener.open.assert_called_once()
        with self.assertRaises(exporter.ExportRefused):exporter.unique_object([('site_url','a'),('site_url','b')])
        with self.assertRaises(exporter.ExportRefused):exporter.project([],TOKEN)
        for token in ('','bad\ntoken','bad\rtoken','bad token'):
            with patch.object(exporter.urllib.request,'build_opener') as build:
                with self.assertRaises(exporter.ExportRefused):exporter.fetch(token)
                build.assert_not_called()
    def test_atomic_owner_private_write_and_filled_file_is_never_overwritten(self):
        with TemporaryDirectory() as directory:
            destination=Path(directory)/'oracle-auth-settings.json'
            destination.write_text('{"format":"ir35-auth-settings-handoff-v1","field":null}')
            exporter.custody(destination,apply=True);snapshot=exporter.target_snapshot(destination)
            result=exporter.project({'site_url':'https://www.example.invalid'},TOKEN)
            digest=exporter.write_export(destination,result,snapshot)
            body=destination.read_bytes();self.assertEqual(digest,hashlib.sha256(body).hexdigest())
            exporter.custody(destination)
            self.assertEqual(json.loads(body),result)
            self.assertEqual(list(Path(directory).iterdir()),[destination])
            with self.assertRaises(exporter.ExportRefused):exporter.target_snapshot(destination)
            self.assertEqual(destination.read_bytes(),body)
    def test_changed_or_linked_destination_is_refused_preserving_existing_bytes(self):
        with TemporaryDirectory() as directory:
            destination=Path(directory)/'oracle-auth-settings.json';destination.write_text('{}')
            exporter.custody(destination,apply=True);snapshot=exporter.target_snapshot(destination)
            destination.write_text('{"owner_edit":"retained"}')
            with self.assertRaises(exporter.ExportRefused):exporter.write_export(destination,exporter.project({},TOKEN),snapshot)
            self.assertEqual(destination.read_text(),'{"owner_edit":"retained"}')
            self.assertEqual(list(Path(directory).iterdir()),[destination])
    def test_main_hidden_prompt_and_success_output_contain_only_three_metadata_fields(self):
        with TemporaryDirectory() as directory:
            destination=Path(directory)/'oracle-auth-settings.json';opener=Mock()
            opener.open.return_value=Response({'site_url':'https://www.example.invalid','smtp_pass':'do-not-copy'})
            output=StringIO()
            with patch.object(exporter,'DESTINATION',destination),patch.object(exporter,'native_windows',return_value=True),\
                    patch.object(sys,'argv',['export_auth_settings.py']),patch.object(getpass,'getpass',return_value=TOKEN) as prompt,\
                    patch.object(exporter.urllib.request,'build_opener',return_value=opener),redirect_stdout(output):
                status=exporter.main()
            self.assertEqual(status,0);prompt.assert_called_once()
            result=json.loads(output.getvalue())
            self.assertEqual(set(result),{'field_count','null_fields','file_sha256'})
            self.assertEqual(result['file_sha256'],hashlib.sha256(destination.read_bytes()).hexdigest())
            self.assertNotIn(TOKEN,output.getvalue());self.assertNotIn('do-not-copy',destination.read_text())
    def test_failed_request_or_unavailable_hidden_prompt_never_exposes_token_or_changes_file(self):
        for hidden_failure in (False,True):
            with TemporaryDirectory() as directory:
                destination=Path(directory)/'oracle-auth-settings.json';destination.write_text('{}')
                exporter.custody(destination,apply=True);output=StringIO()
                with patch.object(exporter,'DESTINATION',destination),patch.object(exporter,'native_windows',return_value=True),\
                        patch.object(sys,'argv',['export_auth_settings.py']),\
                        patch.object(getpass,'getpass',side_effect=getpass.GetPassWarning(TOKEN) if hidden_failure else None,return_value=TOKEN),\
                        patch.object(exporter,'fetch',side_effect=RuntimeError(TOKEN)) as fetch,redirect_stdout(output):
                    status=exporter.main()
                self.assertEqual(status,1);self.assertEqual(destination.read_text(),'{}')
                self.assertNotIn(TOKEN,output.getvalue())
                self.assertEqual(set(json.loads(output.getvalue())),{'field_count','null_fields','file_sha256'})
                if hidden_failure:fetch.assert_not_called()
    def test_local_acl_child_receives_only_public_path_code_and_no_token_environment(self):
        reply=Mock(returncode=0,stdout=b'ok')
        with patch.object(exporter.subprocess,'CREATE_NO_WINDOW',0,create=True),\
                patch.object(exporter.subprocess,'run',return_value=reply) as command:
            exporter.windows_acl(Path('public-fixture-path'),apply=True)
        self.assertNotIn(TOKEN,repr(command.call_args))
        self.assertEqual(set(command.call_args.kwargs['env']),{'SystemRoot','WINDIR'})
        self.assertNotIn('SUPABASE_ACCESS_TOKEN',repr(command.call_args))
    def test_token_argument_is_rejected_without_echo_or_prompt(self):
        output=StringIO()
        with patch.object(sys,'argv',['export_auth_settings.py',TOKEN]),\
                patch.object(getpass,'getpass') as prompt,patch.object(exporter,'fetch') as fetch,redirect_stdout(output):
            self.assertEqual(exporter.main(),1)
        prompt.assert_not_called();fetch.assert_not_called();self.assertNotIn(TOKEN,output.getvalue())
    def test_source_has_one_get_constructor_no_environment_token_or_other_endpoint(self):
        source=inspect.getsource(exporter);tree=ast.parse(source)
        calls=[node for node in ast.walk(tree) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='Request']
        self.assertEqual(len(calls),1)
        self.assertEqual([kw.value.value for kw in calls[0].keywords if kw.arg=='method'],['GET'])
        self.assertFalse(any(kw.arg=='data' for kw in calls[0].keywords))
        for verb in ('PATCH','PUT','POST'):self.assertNotIn(verb,source)
        self.assertNotIn('SUPABASE_ACCESS_TOKEN',source)
        self.assertEqual(source.count('https://api.supabase.com/'),1)


if __name__=='__main__':unittest.main()
