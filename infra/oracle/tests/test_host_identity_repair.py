import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host_identity_repair as repair
from key_ceremony import KeySafetyError


class IdentityRepairTests(unittest.TestCase):
    def test_only_host_block_not_arbitrary_console_hash_is_a_trust_source(self):
        fingerprint = "SHA256:" + "a" * 43
        self.assertIsNone(repair.console_fingerprint("arbitrary " + fingerprint))
        block = "-----BEGIN SSH HOST KEY FINGERPRINTS-----\n256 " + fingerprint + " root@fixture (ED25519)\n-----END SSH HOST KEY FINGERPRINTS-----"
        self.assertEqual(repair.console_fingerprint(block), {"algorithm": "ed25519", "fingerprint": fingerprint})
        self.assertNotIn("root@fixture", json.dumps(repair.console_fingerprint(block)))

    def test_ecdsa_supported_but_partial_or_conflicting_blocks_stop(self):
        start, end = "BEGIN SSH HOST KEY FINGERPRINTS\n", "\nEND SSH HOST KEY FINGERPRINTS"
        fp = "SHA256:" + "b" * 43
        self.assertEqual(repair.console_fingerprint(start + "256 " + fp + " (ECDSA)" + end)["algorithm"], "ecdsa")
        for value in (start, end, start + "unsupported" + end,
                      start + "256 " + fp + " (ED25519)\n256 SHA256:" + "c" * 43 + " (ED25519)" + end):
            with self.assertRaises(KeySafetyError):
                repair.console_fingerprint(value)

    def test_foreign_console_cannot_be_read_or_deleted(self):
        state = {"instanceId": "ocid1.instance.oc1.uk-london-1.controlledfixture01"}
        with self.assertRaises(KeySafetyError), patch.object(repair.infra, "invoke") as call:
            repair.console_identity({"instance-id": "other"}, state, {})
        call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
