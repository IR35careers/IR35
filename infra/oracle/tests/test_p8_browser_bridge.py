from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import p8_browser_bridge as bridge
from offline_bundle_fixture import public_bootstrap


class BrowserBridgeTests(unittest.TestCase):
    def test_private_bootstrap_is_readonly_and_has_no_direct_cli(self):
        with public_bootstrap(): source=bridge.private_program({'public':'fixture'})
        compile(source,'<public-bootstrap>','exec')
        for text in ('docker run','docker restart','systemctl','CREATE DATABASE','readonly=False','write_text','openssl'):
            # Old modules contain mutation function DEFINITIONS; enforce this
            # on the new executable body, while compiling the full dependency
            # bundle unchanged. Same semantic ban, not a substring of quoted
            # historical function definitions that are never called here.
            self.assertNotIn(text,bridge.BOOTSTRAP_BODY)
        for guard in ('ExistingPrivateSMTPSinkRequired','ProtectedReadonlyMockFixtureRequired','ExistingBasicCredentialShapeRequired'):
            self.assertIn(guard,source)
        self.assertIn("Imported by native browser controller only",Path(bridge.__file__).read_text())

    def test_containment_is_original_complete_verifier_not_a_subset(self):
        with public_bootstrap(): source=bridge.containment_program({'public':'fixture'})
        compile(source,'<public-containment>','exec')
        self.assertIn("containment(data,runtime,probe_container='ir35-p6-mock-worker-v7-fixedip')",source)
        self.assertNotIn('readonly=False',bridge.CONTAINMENT_BODY)
        with patch.object(bridge.schema,'run_guest',return_value={'status':'PASS'}) as remote,patch.object(bridge,'containment_program',return_value='public-only'):
            self.assertEqual(bridge.full_containment({'public':'fixture'}),{'status':'PASS'})
            remote.assert_called_once_with('public-only',timeout=600)


if __name__=='__main__':unittest.main()
