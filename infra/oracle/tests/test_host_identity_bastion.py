import base64
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host_identity_bastion as bastion
from key_ceremony import KeySafetyError

KEY = "ssh-ed25519 " + base64.b64encode(b"\0\0\0\x0bssh-ed25519\0\0\0\x20" + b"\0" * 32).decode()


class BastionIdentityTests(unittest.TestCase):
    def test_public_key_newline_is_not_a_different_key_but_changed_target_still_fails(self):
        spec = bastion.payload("ocid1.bastion.oc1.uk-london-1.controlledfixture01", "ocid1.instance.oc1.uk-london-1.controlledfixture01", "10.35.1.8", KEY)
        row = json.loads(json.dumps(spec))
        row = {bastion.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in row.items()}
        row["key-details"] = {"public-key-content": KEY + "\n"}
        row["target-resource-details"] = {bastion.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in spec["targetResourceDetails"].items()}
        row["id"] = "ocid1.bastionsession.oc1.uk-london-1.controlledfixture01"
        self.assertEqual(bastion.verify_session(spec, row), row["id"])
        row["target-resource-details"]["target-resource-port"] = 5432
        with self.assertRaises(KeySafetyError):
            bastion.verify_session(spec, row)

    def test_gateway_first_use_is_restricted_to_public_scan_with_verified_guest_source(self):
        with self.assertRaisesRegex(KeySafetyError, "Authenticated guest fingerprint"):
            bastion.scan_through_bastion({}, {}, {}, "ed25519")
        options = bastion.ssh_options({"socket": "/fixture"}, Path("/fixture/hosts"), "fixture", public_scan_bootstrap=True)
        self.assertIn("StrictHostKeyChecking=accept-new", options)
        self.assertIn("ForwardAgent=no", options)
        self.assertIn("PasswordAuthentication=no", options)
    def test_mismatch_stops_and_cleans_only_session_without_clearing_host_hold(self):
        fingerprint = {"algorithm": "ed25519", "fingerprint": "SHA256:" + "a" * 43}
        state = {"console": {"publicFingerprint": fingerprint}}
        journal = {"computeReadback": {"publicIP": "8.8.8.8"}, "stop": {"code": "ConsoleFingerprintMissing"}}
        with patch.object(bastion, "ensure_session_once", return_value=({}, {})), \
                patch.object(bastion, "scan_through_bastion", return_value="untrusted"), \
                patch.object(bastion.host_ssh, "match_host_key", side_effect=KeySafetyError("mismatch")), \
                patch.object(bastion, "remove_session") as cleanup, patch.object(bastion, "write_new") as pin:
            with self.assertRaisesRegex(KeySafetyError, "mismatch"):
                bastion.verify_and_pin(state, journal, {}, None)
            cleanup.assert_called_once()
            pin.assert_not_called()
        self.assertEqual(journal["stop"]["code"], "ConsoleFingerprintMissing")

    def test_gateway_key_comes_from_signed_api_and_not_tofu(self):
        self.assertEqual(bastion.gateway_key(KEY), KEY)
        for value in (None, "arbitrary", "ssh-ed25519 AAAA", KEY + "\nssh-rsa AAAA"):
            with self.assertRaises(KeySafetyError):
                bastion.gateway_key(value)
        options = bastion.ssh_options({"socket": "/controlled/fixture"}, Path("/controlled/hosts"), "controlled-alias")
        self.assertIn("StrictHostKeyChecking=yes", options)
        self.assertIn("ForwardAgent=no", options)
        self.assertFalse(any("accept-new" in value for value in options))

    def test_only_existing_vm_private_subnet_and_port22_with_short_ttl(self):
        spec = bastion.payload("ocid1.bastion.oc1.uk-london-1.controlledfixture01", "ocid1.instance.oc1.uk-london-1.controlledfixture01", "10.35.1.8", KEY)
        self.assertEqual(spec["targetResourceDetails"]["targetResourcePort"], 22)
        self.assertEqual(spec["targetResourceDetails"]["sessionType"], "PORT_FORWARDING")
        self.assertEqual(spec["sessionTtlInSeconds"], 1800)
        with self.assertRaises(KeySafetyError):
            bastion.payload(spec["bastionId"], spec["targetResourceDetails"]["targetResourceId"], "8.8.8.8", KEY)

    def test_iam_must_be_removed_before_bastion_or_guest_enrolment(self):
        with patch.object(bastion, "ensure_session_once") as create:
            with self.assertRaisesRegex(KeySafetyError, "cleanup must PASS"):
                bastion.verify_and_pin({"console": {"publicFingerprint": None}}, {}, {}, None)
            create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
