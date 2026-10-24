import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import staging_stack
import web_stack


class WebStackTests(unittest.TestCase):
    def test_native_pin_and_hard_web_envelope(self):
        data=web_stack.compose('sha256:'+'a'*64,'ir35-staging_backend')
        web=data['services']['web']
        self.assertEqual(web['platform'],'linux/arm64')
        self.assertEqual(web['mem_limit'],'1536m')
        self.assertEqual(web['user'],'1002:1002')
        self.assertTrue(web['read_only'])
        self.assertEqual(web['cap_drop'],['ALL'])
        self.assertNotIn('ports',web)
        self.assertEqual(web['logging']['driver'],'none')
        self.assertIn('/opt/ir35/data/p5-next-cache:/app/.next/cache',web['volumes'])
        self.assertRegex(web_stack.NODE_IMAGE,r'@sha256:[a-f0-9]{64}$')

    def test_never_accept_arbitrary_image_or_network(self):
        for image,network in [('node:latest','ir35-staging_backend'),('sha256:'+'a'*64,'bridge')]:
            with self.assertRaises(ValueError):web_stack.compose(image,network)

    def test_app_backend_has_no_public_ports_or_secret_environment_values(self):
        import json
        pins=json.loads((Path(__file__).resolve().parents[1]/'staging-images.json').read_text())['images']
        data=web_stack.app_compose('sha256:'+'b'*64,'ir35-staging_backend',pins)
        self.assertEqual(set(data['services']),{'web','auth','rest','storage','kong'})
        self.assertEqual(data['services']['auth']['command'],['auth','serve'])
        for name,service in data['services'].items():
            self.assertNotIn('ports',service)
            self.assertNotIn('environment',service)
            self.assertTrue(service['read_only'])
            self.assertEqual(service['logging']['driver'],'none')
        self.assertIn('/opt/ir35/data/p5-storage:/var/lib/storage:ro',data['services']['storage']['volumes'])

    def test_only_approved_staging_hosts_and_exact_cookie_gate(self):
        result=web_stack.caddyfile(staging_stack.CADDYFILE)
        self.assertIn('basic_auth',result)
        self.assertIn('noindex, nofollow, noarchive',result)
        self.assertIn('(^|;[ ]*)__Host-ir35-staging={$STAGING_GATE_TOKEN}(;|$)',result)
        self.assertIn('Secure; HttpOnly; SameSite=Strict',result)
        self.assertIn('header Cache-Control "no-store"',result)
        self.assertIn('reverse_proxy ir35-p5-web:3000',result)
        self.assertIn('reverse_proxy @api ir35-p5-kong:8000',result)
        self.assertNotIn('www.ir35careers.com {',result)
        self.assertNotIn('api.ir35careers.com {',result)
        self.assertNotIn('admin.ir35careers.com {',result)
        self.assertIn('header_up -Cookie',result)


if __name__=='__main__':unittest.main()
