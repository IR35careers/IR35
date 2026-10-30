import ast
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p8_caddy_head_owner as head


class HeadOwnerTests(unittest.TestCase):
    def test_only_one_response_and_public_allowlisted_headers(self):
        code,headers=head.parse_head('HTTP/2 401\r\nCache-Control: no-store\r\nX-Robots-Tag: noindex\r\nSet-Cookie: PRIVATE-NOT-FOR-OUTPUT\r\n\r\n')
        self.assertEqual(code,401);self.assertEqual(headers,{'cache-control':'no-store','x-robots-tag':'noindex'})
        with self.assertRaises(RuntimeError):head.parse_head('HTTP/1.1 308 Redirect\nHTTP/2 401\n')

    def test_guest_compiles_fixed_tls_verified_credentials_free_heads_only(self):
        code=head.program();ast.parse(code)
        for needed in ("['curl','-I'","':443:127.0.0.1'","credentialsSent':False",'activationPerformed\':False'):
            self.assertIn(needed,code)
        for forbidden in ('--insecure','-k\'',"'Authorization'",'read_env','docker','restart(','write_text','write_bytes'):
            self.assertNotIn(forbidden,code)


if __name__=='__main__':unittest.main()
