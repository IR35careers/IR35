from pathlib import Path
import json
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from p1_evidence import public_report


class EvidenceTests(unittest.TestCase):
    def test_specs_credentials_source_ips_and_private_values_never_export(self):
        sentinel = "private-sentinel"
        control = {"created": {"quota": {"id": "ocid1.quota.oc1..controlledfixture01", "verifiedAt": "2026-10-20T00:00:00Z",
                   "spec": {"password": sentinel}, "effectiveReadback": {"limits": {"standard-a1-core-count": "2"}},
                   "visibility": [{"result": "NOT_YET_VISIBLE", "status": 404, "secret": sentinel}]}}}
        infrastructure = {"ownerCIDR": sentinel, "intent": sentinel, "pending": {"kind": "vcn", "spec": sentinel}, "created": {}}
        report = public_report(control, infrastructure)
        self.assertNotIn(sentinel, json.dumps(report))
        self.assertEqual(report["pendingKind"], "vcn")
        self.assertEqual(report["resources"][0]["visibility"], [{"result": "NOT_YET_VISIBLE", "status": 404}])
        self.assertFalse(report["phaseComplete"])

    def test_encryption_and_host_hold_are_allowlisted_not_raw_console(self):
        report = public_report({}, {"created": {}, "stop": {"kind": "sshHostTrust", "code": "ConsoleFingerprintMissing", "realFailure": True},
            "encryptionRepair": {"complete": True, "instanceEncryptionEnabled": True, "attachmentEncryptionEnabled": True,
                                 "bootEncryption": {"isPvEncryptionInTransitEnabled": True}, "secret": "private-sentinel"},
            "sshHostTrust": {"status": "FAIL", "consoleFingerprintCount": 0, "console": "private-sentinel"}})
        self.assertTrue(report["encryptionRepair"]["complete"])
        self.assertTrue(report["bootEncryption"]["isPvEncryptionInTransitEnabled"])
        self.assertEqual(report["blocker"]["code"], "ConsoleFingerprintMissing")
        self.assertEqual(report["sshHostTrust"]["status"], "FAIL")
        self.assertNotIn("private-sentinel", json.dumps(report))

    def test_phase_pass_requires_reboot_cleanup_and_confirmed_email_not_just_resource_flag(self):
        infrastructure = {"created": {"subscription": {"id": "ocid1.onssubscription.oc1.uk-london-1.controlledfixture01",
            "verifiedAt": "2026-10-20T00:00:00Z", "subscriptionState": "PENDING"}}, "resourceProvisioningComplete": True, "guestMountComplete": True,
            "sshHostTrust": {"status": "PASS", "fingerprint": "SHA256:" + "a" * 43},
            "dataMountIntent": {"uuid": "controlled-uuid", "prepared": {"bootId": "old"}, "rebootVerified": {
                "bootId": "new", "mounted": True, "uuid": "controlled-uuid", "filesystem": "ext4", "mountpoint": "/opt/ir35/data"}}}
        identity = {"console": {"deleted": True}, "temporaryIam": {"policy": {"deleted": True}, "group": {"deleted": True}},
                    "bastionVerification": {"deleted": True, "gatewayTrustMethod": "first-use-gateway-public-scan-only;not-out-of-band-verified"}}
        self.assertFalse(public_report({}, infrastructure, identity)["phaseComplete"])
        infrastructure["created"]["subscription"]["subscriptionState"] = "ACTIVE"
        self.assertTrue(public_report({}, infrastructure, identity)["phaseComplete"])
        with self.subTest("a recorded failure always prevents signoff"):
            infrastructure["stop"] = {"code": "BucketSummaryIdentifierMissing"}
            self.assertFalse(public_report({}, infrastructure, identity)["phaseComplete"])
            infrastructure.pop("stop")
        with self.subTest("a pending bucket always prevents signoff"):
            infrastructure["pending"] = {"kind": "bucket"}
            self.assertFalse(public_report({}, infrastructure, identity)["phaseComplete"])
            infrastructure.pop("pending")
        with self.subTest("wrong filesystem identity cannot pass"):
            infrastructure["dataMountIntent"]["rebootVerified"]["uuid"] = "different"
            self.assertFalse(public_report({}, infrastructure, identity)["phaseComplete"])
            infrastructure["dataMountIntent"]["rebootVerified"]["uuid"] = "controlled-uuid"
        with self.subTest("missing fingerprint cannot pass"):
            infrastructure["sshHostTrust"].pop("fingerprint")
            self.assertFalse(public_report({}, infrastructure, identity)["phaseComplete"])


if __name__ == "__main__":
    unittest.main()
