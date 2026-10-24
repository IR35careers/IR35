import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from immutable_artifacts import Store
from sdk_gate_observation import Observer,response_headers


class GateObservationTests(unittest.TestCase):
    def test_failure_is_written_before_caller_asserts_and_cannot_be_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);root.chmod(0o700);store=Store(root);stage=store.stage('01-test');observer=Observer(store,stage)
            result=observer.case('missing','GET','/supabase/auth/v1/health',401,lambda _: (404,{},b''))
            self.assertFalse(result['passed'])
            self.assertEqual(json.loads((stage/'case-missing.json').read_text())['actualStatus'],404)
            with self.assertRaises(FileExistsError):observer.case('missing','GET','/supabase/auth/v1/health',401,lambda _:(401,{},b''))

    def test_transport_failure_is_recorded_without_error_message_or_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);root.chmod(0o700);store=Store(root);stage=store.stage('01-test');observer=Observer(store,stage)
            def denied(_):raise ValueError('never-print-password-token')
            result=observer.case('valid','GET','/supabase/auth/v1/health',200,denied)
            self.assertEqual(result['transportError'],'ValueError')
            self.assertNotIn('never-print',json.dumps(result))
            self.assertIsNone(result['actualStatus'])

    def test_secret_response_fields_are_redacted_not_omitted(self):
        value=response_headers({'Set-Cookie':'__Host-ir35-staging=secret-token; Path=/; Secure; HttpOnly; SameSite=Strict',
                                'Authorization':'Bearer secret-token','Content-Security-Policy':"script-src 'nonce-secret-token'",'X-Caddy-Request-ID':'a'*36})
        self.assertNotIn('secret-token',json.dumps(value))
        self.assertIn('Secure',value['set-cookie']);self.assertEqual(value['authorization'],'<redacted>')


if __name__=='__main__':unittest.main()
