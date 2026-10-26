import ast
from contextlib import contextmanager,redirect_stdout
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
import fill_auth_supplement as supplement

TOKEN='sbp_fixture_only_never_a_real_token'
PASSWORD='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
PUBLIC_ID='public-fixture.apps.googleusercontent.com'


@contextmanager
def fixture(settings=None,*,real_custody=False):
    with TemporaryDirectory() as temporary:
        root=Path(temporary);source=root/'source.json';target=root/'supplement.json'
        source.write_bytes(b'{"fixture":"public-only immutable source"}\n')
        digest=hashlib.sha256(source.read_bytes()).hexdigest()
        document={'format':supplement.FORMAT,'source_export_sha256':digest,
            'settings':settings if settings is not None else {name:None for name in supplement.FIELDS}}
        target.write_text(json.dumps(document))
        if real_custody:
            exporter.custody(source,apply=True);exporter.custody(target,apply=True)
        with patch.object(supplement,'SOURCE',source),patch.object(supplement,'DESTINATION',target),\
                patch.object(supplement,'SOURCE_SHA256',digest):
            if real_custody:yield source,target
            else:
                with patch.object(exporter,'custody') as custody:yield source,target


def run_main(payload,*,failure=None,hidden_warning=False,args=None):
    output=StringIO()
    fetched=supplement.project_two(payload,TOKEN)
    with patch.object(exporter,'native_windows',return_value=True),\
            patch.object(sys,'argv',args or ['fill_auth_supplement.py']),\
            patch.object(getpass,'getpass',side_effect=getpass.GetPassWarning(TOKEN) if hidden_warning else None,return_value=TOKEN) as prompt,\
            patch.object(exporter,'fetch',side_effect=failure,return_value=fetched) as fetch,redirect_stdout(output):
        code=supplement.main()
    return code,json.loads(output.getvalue()),output.getvalue(),prompt,fetch


class SupplementTests(unittest.TestCase):
    def test_password_character_classes_symbols_unicode_and_empty_are_exact(self):
        for value in (PASSWORD,'','a:A:0:!@£é漢字',':',' \\:\t'):
            result=supplement.project_two({'password_required_characters':value},TOKEN)
            self.assertEqual(result['settings']['password_required_characters'],value)
            self.assertEqual(result['source_observations']['password_required_characters'],{'state':'present','source_type':'string'})
            self.assertEqual(exporter.project({'password_required_characters':value},TOKEN)['settings']['password_required_characters'],value)

    def test_google_public_ids_accept_string_list_and_empty_without_normalisation(self):
        for value in ('','  ',PUBLIC_ID,PUBLIC_ID+', '+PUBLIC_ID,[],[PUBLIC_ID,'second-public.apps.googleusercontent.com']):
            result=supplement.project_two({'external_google_additional_client_ids':value},TOKEN)
            self.assertEqual(result['settings']['external_google_additional_client_ids'],value)
            self.assertEqual(result['source_observations']['external_google_additional_client_ids']['state'],'present')
            self.assertEqual(exporter.project({'external_google_additional_client_ids':value},TOKEN)['settings']['external_google_additional_client_ids'],value)

    def test_explicit_null_is_not_missing_and_never_becomes_an_inferred_empty_value(self):
        absent=supplement.project_two({},TOKEN)
        explicit=supplement.project_two({name:None for name in supplement.FIELDS},TOKEN)
        for name in supplement.FIELDS:
            self.assertEqual(absent['source_observations'][name],{'state':'absent','source_type':'absent'})
            self.assertEqual(explicit['source_observations'][name],{'state':'explicit_null','source_type':'null'})
            self.assertIsNone(explicit['settings'][name])

    def test_bad_types_and_nested_values_are_rejected_not_filtered_into_public_lists(self):
        for name in supplement.FIELDS:
            values=(False,0,{},[{'secret':'not-exported'}],[1],[None])
            if name=='password_required_characters':values+=([PUBLIC_ID],[])
            for value in values:
                result=supplement.project_two({name:value},TOKEN)
                self.assertEqual(result['source_observations'][name]['state'],'invalid_type')
                self.assertIsNone(result['settings'][name])
        with self.assertRaises(exporter.ExportRefused):exporter.public_setting({},'smtp_pass',TOKEN)

    def test_all_credential_exclusions_still_apply_to_both_fields_and_each_list_item(self):
        jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.fake'
        for value in (TOKEN,jwt,'https://user:password@example.invalid','sb_secret_fixturevalue'):
            for name in supplement.FIELDS:
                result=supplement.project_two({name:value},TOKEN)
                self.assertEqual(result['source_observations'][name]['state'],'unsafe_value')
                self.assertNotIn(value,json.dumps(result))
            result=supplement.project_two({'external_google_additional_client_ids':[PUBLIC_ID,value]},TOKEN)
            self.assertEqual(result['source_observations']['external_google_additional_client_ids']['state'],'unsafe_value')
            self.assertIsNone(result['settings']['external_google_additional_client_ids'])

    def test_other_exported_fields_and_every_unknown_credential_are_unchanged(self):
        payload={'site_url':'https://example.invalid','smtp_pass':TOKEN,'smtp_user':'never-copy',
            'jwt_exp':12,'jwt_secret':TOKEN,'external_google_secret':TOKEN,'hook_send_email_uri':'https://user:pass@example.invalid',
            'unknown_secret':TOKEN,'mailer_templates_recovery_content':'<p>{{ .ConfirmationURL }}</p>'}
        result=exporter.project(payload,TOKEN)
        self.assertEqual(result['settings']['site_url'],payload['site_url'])
        self.assertEqual(result['settings']['mailer_templates_recovery_content'],payload['mailer_templates_recovery_content'])
        for name in ('smtp_pass','smtp_user','jwt_exp','jwt_secret','external_google_secret','hook_send_email_uri','unknown_secret'):
            self.assertNotIn(name,result['settings'])
        self.assertNotIn(TOKEN,json.dumps(result))

    def test_custom_projector_uses_same_single_fixed_get_without_request_body(self):
        reply=Mock();reply.status=200;reply.geturl.return_value=exporter.ENDPOINT
        reply.read.return_value=json.dumps({'password_required_characters':PASSWORD,'external_google_additional_client_ids':[],'smtp_pass':TOKEN}).encode()
        context=Mock();context.__enter__=Mock(return_value=reply);context.__exit__=Mock(return_value=None)
        opener=Mock();opener.open.return_value=context
        with patch.object(exporter.urllib.request,'build_opener',return_value=opener):
            result=exporter.fetch(TOKEN,projector=supplement.project_two)
        opener.open.assert_called_once();request=opener.open.call_args.args[0]
        self.assertEqual((request.full_url,request.get_method(),request.data),(exporter.ENDPOINT,'GET',None))
        self.assertEqual(set(result['settings']),set(supplement.FIELDS));self.assertNotIn(TOKEN,json.dumps(result))
        self.assertIsNone(request.get_header('Authorization'))

    def test_one_run_fills_only_two_fields_preserves_source_and_prints_only_metadata(self):
        with fixture() as (source,target):
            before=source.read_bytes()
            code,summary,output,prompt,fetch=run_main({'password_required_characters':PASSWORD,'external_google_additional_client_ids':[PUBLIC_ID],'smtp_pass':TOKEN})
            self.assertEqual(code,0);prompt.assert_called_once();fetch.assert_called_once()
            self.assertIs(fetch.call_args.kwargs['projector'],supplement.project_two)
            self.assertEqual(source.read_bytes(),before)
            document=json.loads(target.read_text());self.assertEqual(set(document['settings']),set(supplement.FIELDS))
            self.assertEqual(document['settings']['password_required_characters'],PASSWORD)
            self.assertEqual(document['settings']['external_google_additional_client_ids'],[PUBLIC_ID])
            self.assertEqual(set(summary),{'field_count','null_fields','file_sha256'})
            self.assertEqual(summary['field_count'],2);self.assertEqual(summary['null_fields'],[])
            self.assertEqual(summary['file_sha256'],hashlib.sha256(target.read_bytes()).hexdigest())
            self.assertNotIn(TOKEN,output);self.assertNotIn(PASSWORD,output);self.assertNotIn(PUBLIC_ID,output)
            journals=list(target.parent.glob('oracle-auth-supplement-*.json'));self.assertEqual(len(journals),2)
            for path in journals:
                body=path.read_text();self.assertNotIn(TOKEN,body);self.assertNotIn(PASSWORD,body);self.assertNotIn(PUBLIC_ID,body)

    def test_populated_empty_string_or_list_is_preserved_not_replaced(self):
        for preserved in ('',[],[PUBLIC_ID]):
            with fixture({'password_required_characters':None,'external_google_additional_client_ids':preserved}) as (source,target):
                code,summary,output,prompt,fetch=run_main({'password_required_characters':PASSWORD,'external_google_additional_client_ids':['different-public.apps.googleusercontent.com']})
                self.assertEqual(code,0);self.assertEqual(json.loads(target.read_text())['settings']['external_google_additional_client_ids'],preserved)

    def test_already_populated_supplement_is_byte_identical_without_prompt_or_network(self):
        with fixture({'password_required_characters':'','external_google_additional_client_ids':[]}) as (source,target):
            before=target.read_bytes()
            code,summary,output,prompt,fetch=run_main({})
            self.assertEqual(code,0);self.assertEqual(target.read_bytes(),before);prompt.assert_not_called();fetch.assert_not_called()
            self.assertEqual(len(list(target.parent.iterdir())),2)

    def test_explicit_source_nulls_are_attested_without_guessing_and_cannot_trigger_another_prompt(self):
        with fixture() as (source,target):
            code,summary,output,prompt,fetch=run_main({name:None for name in supplement.FIELDS})
            self.assertEqual(code,0);self.assertEqual(summary['null_fields'],list(supplement.FIELDS))
            document=json.loads(target.read_text());self.assertEqual(supplement.pending(document),())
            before=target.read_bytes()
            code,summary,output,prompt,fetch=run_main({})
            self.assertEqual(code,0);prompt.assert_not_called();fetch.assert_not_called();self.assertEqual(target.read_bytes(),before)

    def test_missing_or_rejected_response_preserves_file_and_records_fixed_reason_only(self):
        for payload in ({},{'password_required_characters':TOKEN,'external_google_additional_client_ids':[]}):
            with fixture() as (source,target):
                before=target.read_bytes()
                code,summary,output,prompt,fetch=run_main(payload)
                self.assertEqual(code,1);self.assertEqual(summary['field_count'],0);self.assertEqual(target.read_bytes(),before)
                fetch.assert_called_once();self.assertNotIn(TOKEN,output)
                result=json.loads(next(target.parent.glob('*-result.json')).read_text())
                self.assertEqual(result['code'],'RequiredFieldAbsentInvalidOrUnsafe')
                self.assertIn('source_observations',result);self.assertNotIn(TOKEN,json.dumps(result))

    def test_network_failure_has_no_retry_or_raw_error_and_preserves_existing_file(self):
        with fixture() as (source,target):
            before=target.read_bytes()
            code,summary,output,prompt,fetch=run_main({},failure=RuntimeError('raw private '+TOKEN))
            self.assertEqual(code,1);fetch.assert_called_once();self.assertEqual(target.read_bytes(),before)
            self.assertNotIn(TOKEN,output)
            for path in target.parent.glob('oracle-auth-supplement-*.json'):self.assertNotIn(TOKEN,path.read_text())

    def test_hidden_prompt_warning_and_token_argument_are_rejected_without_fetch_or_echo(self):
        for kwargs in ({'hidden_warning':True},{'args':['fill_auth_supplement.py',TOKEN]}):
            with fixture() as (source,target):
                before=target.read_bytes()
                code,summary,output,prompt,fetch=run_main({},**kwargs)
                self.assertEqual(code,1);fetch.assert_not_called();self.assertNotIn(TOKEN,output);self.assertEqual(target.read_bytes(),before)
                if 'args'in kwargs:prompt.assert_not_called()

    def test_source_binding_or_unknown_fields_fail_before_prompt(self):
        for mutation in ('source','binding','unknown','duplicate'):
            with fixture() as (source,target):
                if mutation=='source':source.write_bytes(b'changed source')
                elif mutation=='duplicate':target.write_text('{"settings":{},"settings":{}}')
                else:
                    doc=json.loads(target.read_text())
                    if mutation=='binding':doc['source_export_sha256']='0'*64
                    else:doc['settings']['smtp_pass']='never-copy'
                    target.write_text(json.dumps(doc))
                before=target.read_bytes()
                code,summary,output,prompt,fetch=run_main({})
                self.assertEqual(code,1);prompt.assert_not_called();fetch.assert_not_called();self.assertEqual(target.read_bytes(),before)

    def test_existing_lock_is_preserved_without_prompt_or_retry(self):
        with fixture() as (source,target):
            lock=target.with_name('.ir35-auth-supplement.lock');lock.write_bytes(b'prior attempt retained')
            code,summary,output,prompt,fetch=run_main({})
            self.assertEqual(code,1);prompt.assert_not_called();fetch.assert_not_called();self.assertEqual(lock.read_bytes(),b'prior attempt retained')

    def test_concurrent_edit_is_preserved_not_replaced(self):
        for changed in ('source','target'):
            with fixture() as (source,target):
                edited=source if changed=='source' else target
                def during_fetch(*args,**kwargs):
                    edited.write_bytes(b'owner concurrent edit retained')
                    return supplement.project_two({'password_required_characters':PASSWORD,'external_google_additional_client_ids':[]},TOKEN)
                output=StringIO()
                with patch.object(exporter,'native_windows',return_value=True),patch.object(sys,'argv',['fill_auth_supplement.py']),\
                        patch.object(getpass,'getpass',return_value=TOKEN),patch.object(exporter,'fetch',side_effect=during_fetch),redirect_stdout(output):
                    self.assertEqual(supplement.main(),1)
                self.assertEqual(edited.read_bytes(),b'owner concurrent edit retained');self.assertNotIn(TOKEN,output.getvalue())

    def test_writer_refuses_populated_value_and_unknown_candidate_before_replace(self):
        with fixture({'password_required_characters':'','external_google_additional_client_ids':None}) as (source,target):
            doc,snapshot=supplement.load();before=target.read_bytes()
            doc['settings']['password_required_characters']='changed'
            with self.assertRaisesRegex(supplement.SupplementRefused,'PopulatedValuePreserved'):supplement.write_supplement(doc,snapshot)
            self.assertEqual(target.read_bytes(),before)
            doc,snapshot=supplement.load();doc['unknown_secret']='never-copy'
            with self.assertRaises(supplement.SupplementRefused):supplement.write_supplement(doc,snapshot)
            self.assertEqual(target.read_bytes(),before)

    def test_diagnostic_slot_is_write_once(self):
        with fixture() as (source,target):
            supplement.journal({'status':'FAIL','values_recorded':False},'fixed-fixture')
            path=target.with_name('oracle-auth-supplement-fixed-fixture.json');before=path.read_bytes()
            with self.assertRaises(FileExistsError):supplement.journal({'status':'PASS'},'fixed-fixture')
            self.assertEqual(path.read_bytes(),before)

    def test_native_private_custody_and_atomic_write(self):
        with fixture(real_custody=True) as (source,target):
            doc,snapshot=supplement.load()
            fetched=supplement.project_two({'password_required_characters':PASSWORD,'external_google_additional_client_ids':[]},TOKEN)
            doc.update(fetched)
            digest=supplement.write_supplement(doc,snapshot)
            exporter.custody(source);exporter.custody(target)
            self.assertEqual(digest,hashlib.sha256(target.read_bytes()).hexdigest())

    def test_transport_remains_one_get_and_supplement_never_reads_tokens_from_state(self):
        tree=ast.parse(inspect.getsource(exporter))
        requests=[node for node in ast.walk(tree) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='Request']
        self.assertEqual(len(requests),1)
        self.assertEqual([kw.value.value for kw in requests[0].keywords if kw.arg=='method'],['GET'])
        source=inspect.getsource(supplement)
        for forbidden in ('SUPABASE_ACCESS_TOKEN','os.environ','clipboard','print(token','print(payload'):
            self.assertNotIn(forbidden,source)


if __name__=='__main__':unittest.main()
