import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from immutable_artifacts import Store
import sdk_owner1_guest as gate
import sdk_owner1 as controller
import web_fixture


class SDKOwnerTests(unittest.TestCase):
    def test_old_hold_is_not_lifted_and_new_guest_is_namespaced(self):
        self.assertTrue(web_fixture.migration_held())
        with patch.object(web_fixture.schema,'guest_bundle',return_value=''):
            source=controller.guest({'purpose':'compile-only'})
        compile(source,'sdk-owner1-bundle','exec')
        self.assertIn('sdk_owner1_guest',source)
        self.assertNotIn('web_edge_guest"].activate',source)

    def test_every_case_written_even_if_all_three_sdk_statuses_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);root.chmod(0o700);store=Store(root);stage=store.stage('01-test')
            calls=[]
            def request(host,method,path,headers):
                calls.append((host,method,path));return 404,{'x-caddy-request-id':'a'*8+'-aaaa-aaaa-aaaa-'+'a'*12,'x-ir35-matched-route':'wrong-route','cache-control':'no-store','x-robots-tag':'noindex'},b'{}'
            runtime={'read_env':lambda:{'STAGING_BASIC_PASSWORD':'public-test','ANON_KEY':'public-test'}}
            with patch.object(gate,'private_env',return_value={'STAGING_GATE_TOKEN':'public-test'}):
                records=gate.edge_cases({},runtime,store,stage,request=request)
            self.assertEqual(len(records),10);self.assertEqual(len(calls),10)
            for name in ('sdk-missing','sdk-suffix','sdk-valid'):
                row=json.loads((stage/('case-'+name+'.json')).read_bytes())
                self.assertEqual(row['actualStatus'],404);self.assertFalse(row['passed'])
            self.assertNotIn('public-test',json.dumps(records))

    def test_failed_edge_always_rolls_back_and_is_write_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);root.chmod(0o700);store=Store(root);prepared_stage=store.stage('01-prepare')
            store.put(prepared_stage,'fixture.json',b'{}');anchor=store.seal(prepared_stage)
            prepared={'status':'PASS','stage':'01-prepare','manifestSHA256':anchor,'files':{}}
            with patch.object(gate,'require_dns'),patch.object(gate,'switch') as switch,patch.object(gate,'tls_request',return_value=(401,{},b'')),patch.object(gate,'edge_cases',return_value=[{'passed':False}]):
                result=gate.activate({'dns':{},'privateProof':{}},{},store,prepared)
            self.assertEqual(result['status'],'FAIL');self.assertEqual(result['rollback'],'original Caddy restored')
            self.assertEqual(switch.call_count,2);self.assertEqual(switch.call_args.args[2],gate.ROOT/'compose.yml')
            self.assertEqual(json.loads((root/'02-edge/intent.json').read_bytes())['activationAttempts'],1)
            with patch.object(gate,'require_dns'),self.assertRaises(FileExistsError):gate.activate({'dns':{}},{},store,prepared)

    def test_containment_runs_after_edge_fail_without_retry(self):
        prepared={'status':'PASS'};active={'status':'FAIL'};after={'status':'PASS'}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);root.chmod(0o700);store=Store(root)
            with patch.object(gate,'new_store',return_value=store),patch.object(gate,'prepare',return_value=prepared),patch.object(gate,'activate',return_value=active) as activation,patch.object(gate,'containment',return_value=after) as containment:
                result=gate.run({}, {})
            self.assertEqual(result['status'],'FAIL');activation.assert_called_once();containment.assert_called_once()
            self.assertFalse(result['p6Authorised']);self.assertTrue(result['reviewRequired'])


if __name__=='__main__':unittest.main()
