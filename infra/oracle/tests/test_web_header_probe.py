import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from p4_recovery_guest import RecoveryError
from web_header_probe_guest import configuration


class HeaderProbeTests(unittest.TestCase):
    def test_fixed_private_plain_listener_has_no_tls_admin_or_persisted_secrets(self):
        for mode in ('immediate','deferred','paired'):
            text=configuration(mode)
            self.assertIn('auto_https off',text);self.assertIn('admin off',text)
            self.assertIn(':8080 {',text)
            self.assertIn('{$STAGING_BASIC_HASH}',text)
            self.assertNotIn('443',text);self.assertNotIn('acme',text)
        paired=configuration('paired')
        self.assertIn('header Cache-Control "no-store"',paired)
        self.assertIn('header >Cache-Control "no-store"',paired)
        with self.assertRaises(RecoveryError):configuration('arbitrary')


if __name__=='__main__':unittest.main()
