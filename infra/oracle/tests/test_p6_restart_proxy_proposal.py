"""Offline evidence for a proposed proxy repair, NOT a live repair/retry.

The loopback fixture illustrates a stale endpoint; it does not claim to recover
the missing historical post-restart container IP. No Docker, SSH or OCI calls.
"""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from p6_health_repair_guest import FINAL_UNIT,units


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200);self.end_headers();self.wfile.write(b'{"ok":true}')
    def log_message(self,*args):pass


class RestartProxyProposalTests(unittest.TestCase):
    def test_stale_endpoint_fails_while_new_endpoint_is_healthy_then_retarget_works(self):
        # Linux loopback aliases only; the VM and its services are never used.
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        original=ThreadingHTTPServer(('127.0.0.2',0),Handler)
        port=original.server_address[1]
        thread=threading.Thread(target=original.serve_forever,daemon=True);thread.start()
        old_url=f'http://127.0.0.2:{port}/health'
        try:
            with opener.open(old_url,timeout=1) as reply:self.assertEqual(reply.status,200)
        finally:original.shutdown();original.server_close();thread.join()
        replacement=ThreadingHTTPServer(('127.0.0.3',port),Handler)
        thread=threading.Thread(target=replacement.serve_forever,daemon=True);thread.start()
        try:
            with self.assertRaises(urllib.error.URLError):opener.open(old_url,timeout=1)
            with opener.open(f'http://127.0.0.3:{port}/health',timeout=1) as reply:self.assertEqual(reply.status,200)
        finally:replacement.shutdown();replacement.server_close();thread.join()

    def test_existing_unit_factory_can_retarget_only_ip_without_weakening_sandbox(self):
        before=units('172.18.0.17',unit=FINAL_UNIT)
        after=units('172.18.0.16',unit=FINAL_UNIT)
        self.assertEqual(before[FINAL_UNIT+'.socket'],after[FINAL_UNIT+'.socket'])
        self.assertEqual(before[FINAL_UNIT+'.service'].replace('172.18.0.17','172.18.0.16'),after[FINAL_UNIT+'.service'])
        self.assertIn('ListenStream=127.0.0.1:8787',after[FINAL_UNIT+'.socket'])
        for guard in ('User=ir35','MemoryMax=32M','IPAddressDeny=any','IPAddressAllow=172.18.0.16/32',
                      'NoNewPrivileges=yes','ProtectSystem=strict','InaccessiblePaths=/opt/ir35'):
            self.assertIn(guard,after[FINAL_UNIT+'.service'])

    def test_retarget_cannot_render_public_or_link_local_upstream(self):
        for address in ('8.8.8.8','169.254.169.254','0.0.0.0','::1','example.com'):
            with self.assertRaises((ValueError,RuntimeError)):units(address,unit=FINAL_UNIT)


if __name__=='__main__':unittest.main()
