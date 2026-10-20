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
        self.assertEqual(report["sshHostTrust"]["consoleFingerprintCount"], 0)
        self.assertNotIn("private-sentinel", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
