import hashlib
import hmac
import json
from pathlib import Path
import sys
import unittest
import base64
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import stat
import threading
import urllib.request
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p6_schedule_dispatch as dispatcher


class DispatcherTests(unittest.TestCase):
    def test_real_loopback_dispatch_decodes_original_file_and_preserves_signature(self):
        dummy='f'*64;seen=[]
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body=self.rfile.read(int(self.headers['Content-Length']));stamp=self.headers['X-Ir35-Mock-Timestamp']
                signature=base64.urlsafe_b64encode(hmac.new(dummy.encode(),b'ir35-staging-mock-v1.'+stamp.encode()+b'.POST./mock/schedule.'+body,hashlib.sha256).digest()).decode().rstrip('=')
                valid=hmac.compare_digest(signature,self.headers['X-Ir35-Mock-Signature'])
                seen.append({'body':json.loads(body),'valid':valid})
                self.send_response(202 if valid else 401);self.end_headers();self.wfile.write(b'{"mock":true,"queued":true}' if valid else b'{}')
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        class FixtureOpener:
            def open(self,request,timeout):
                if request.full_url!='http://127.0.0.1:8787/mock/schedule':raise AssertionError('production target changed')
                rewritten=urllib.request.Request('http://127.0.0.1:'+str(server.server_address[1])+'/mock/schedule',data=request.data,headers=dict(request.header_items()),method='POST')
                return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(rewritten,timeout=timeout)
        try:
            with TemporaryDirectory() as directory:
                path=Path(directory)/'dummy-control.env'
                for raw in ("'"+dummy+"'",'"'+dummy+'"',dummy):
                    path.write_text('APPLICATION_WORKER_SECRET='+raw+'\n')
                    with patch.object(dispatcher.os,'fstat',return_value=SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=1002,st_nlink=1)):
                        self.assertEqual(dispatcher.dispatch('watchdog',path=path,opener=FixtureOpener())['status'],'PASS')
            self.assertEqual(len(seen),3);self.assertTrue(all(row['valid'] for row in seen))
            self.assertTrue(all(row['body']['operation']=='watchdog' and 'employerURL' not in row['body'] for row in seen))
        finally:server.shutdown();server.server_close();thread.join()
    def test_single_double_and_unquoted_64hex_with_horizontal_whitespace(self):
        dummy='a'*64
        for raw in (dummy,"'"+dummy+"'",'"'+dummy+'"',' \t'+dummy+' \t',"  '"+dummy+"' \t",'\t"'+dummy+'"  '):
            self.assertEqual(dispatcher.decode_env_value(raw),dummy)
            self.assertEqual(dispatcher.decode_env(' APPLICATION_WORKER_SECRET = '+raw+'\n')['APPLICATION_WORKER_SECRET'],dummy)
    def test_original_66_character_regression_decodes_once_not_twice(self):
        raw="'"+'b'*64+"'"
        self.assertEqual(len(raw),66);self.assertEqual(len(dispatcher.decode_env_value(raw)),64)
        for extra in ("'"+raw+"'",'"'+raw+'"'):
            with self.assertRaises(dispatcher.DispatchError):dispatcher.decode_env_value(extra)
    def test_malformed_quotes_embedded_newlines_and_internal_whitespace_rejected(self):
        for raw in ("'"+'c'*64,'"'+'c'*64,"'"+'c'*64+'"','c'*64+"'",'c'*32+'\n'+'c'*32,'c'*64+'\r','c'*64+'\0',"'abc'def'",''):
            with self.assertRaises(dispatcher.DispatchError):dispatcher.decode_env_value(raw)
        for text in ("APPLICATION_WORKER_SECRET='abc\ndef'\n",'BAD-KEY=x\n','KEY=x\nKEY=y\n','KEY="x\r\ny"\n'):
            with self.assertRaises(dispatcher.DispatchError):dispatcher.decode_env(text)
        self.assertEqual(dispatcher.decode_env_value("' aaaa '"),' aaaa ')
    def test_unexpected_stderr_and_secret_values_are_only_length_and_sha_prefix(self):
        secret='d'*64;error=RuntimeError('remote error '+secret)
        result=dispatcher.error_event(error,'decode-or-dispatch')
        text=json.dumps(result)
        self.assertNotIn(secret,text);self.assertNotIn('remote error',text)
        self.assertEqual(result['stderr']['length'],len(str(error)))
        self.assertEqual(result['stderr']['sha256Prefix'],hashlib.sha256(str(error).encode()).hexdigest()[:12])
        self.assertEqual(dispatcher.error_event(dispatcher.DispatchError('EnvValueMalformed'),'decode-or-dispatch')['code'],'EnvValueMalformed')
    def test_valid_dispatch_preserves_body_auth_headers_and_202_contract(self):
        dummy='e'*64;reply=Mock(status=202);reply.read.return_value=b'{"mock":true,"queued":true}'
        reply.__enter__=Mock(return_value=reply);reply.__exit__=Mock(return_value=False)
        opener=Mock();opener.open.return_value=reply
        with patch.object(dispatcher,'read_control',return_value={'APPLICATION_WORKER_SECRET':dummy}):
            result=dispatcher.dispatch('watchdog',opener=opener)
        request=opener.open.call_args.args[0];body=json.loads(request.data)
        self.assertEqual(body['kind'],'staging_mock_schedule');self.assertEqual(body['operation'],'watchdog')
        self.assertEqual(set(body),{'kind','operation','requestedAt'})
        self.assertEqual(request.full_url,'http://127.0.0.1:8787/mock/schedule')
        self.assertNotIn(dummy,request.full_url);self.assertNotIn(dummy,json.dumps(result))
        self.assertEqual(result['status'],'PASS')
    def test_invalid_hex_and_internal_spaces_fail_before_http(self):
        for value in ('f'*63,'f'*65,'g'*64,' '+'a'*64,'a'*32+' '+'a'*32):
            opener=Mock()
            with patch.object(dispatcher,'read_control',return_value={'APPLICATION_WORKER_SECRET':value}):
                with self.assertRaises(dispatcher.DispatchError):dispatcher.dispatch('watchdog',opener=opener)
            opener.open.assert_not_called()


if __name__=='__main__':unittest.main()
