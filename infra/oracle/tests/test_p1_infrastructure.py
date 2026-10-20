import contextlib
import copy
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p1_infrastructure as infra
from key_ceremony import KeySafetyError
from visibility import OciError, wait_for_visible

CHILD = "ocid1.compartment.oc1..controlledfixture01"
AD = "fixture:UK-LONDON-1-AD-1"
INTENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def fixture():
    return {"version": 1, "intent": INTENT, "ownerCIDR": "8.8.8.8/32", "created": {
        key: {"id": "ocid1." + value[2] + ".oc1.uk-london-1.controlledfixture01"}
        for key, value in infra.KINDS.items() if key != "vcn"}, "pending": None}


class InfrastructureTests(unittest.TestCase):
    def test_fixed_envelope_and_no_broad_ssh(self):
        journal = fixture()
        journal["created"]["vcn"] = {"id": "ocid1.vcn.oc1.uk-london-1.controlledfixture01"}
        instance = infra.specification("instance", journal, CHILD, AD, "ocid1.image.oc1.uk-london-1.controlledfixture01", "ssh-ed25519 " + "A" * 68)
        self.assertEqual(instance["shapeConfig"], {"ocpus": 2, "memoryInGBs": 12})
        self.assertEqual(instance["bootVolumeSizeInGbs"], 50)
        self.assertFalse(instance["assignIpv6Ip"])
        self.assertEqual(infra.specification("volume", journal, CHILD, AD)["sizeInGbs"], 100)
        subnet = infra.specification("subnet", journal, CHILD, AD)
        self.assertEqual(subnet["securityListIds"], [journal["created"]["security"]["id"]])
        rules = infra.ingress("8.8.8.8/32", "10.35.1.7/32")
        self.assertEqual([(row["source"], row["tcpOptions"]["destinationPortRange"]["min"]) for row in rules],
                         [("0.0.0.0/0", 80), ("0.0.0.0/0", 443), ("8.8.8.8/32", 22), ("10.35.1.7/32", 22)])
        for bad in ("0.0.0.0/0", "8.8.8.0/24", "::/0", "10.0.0.1/32"):
            with self.assertRaises(KeySafetyError):
                infra.ingress(bad)

    def test_404_and_unknown_restart_never_repeat_create(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = {**fixture(), "created": {}}
            payload = infra.specification("vcn", journal, CHILD, AD)
            row = {"id": "ocid1.vcn.oc1.uk-london-1.controlledfixture01", "lifecycle-state": "AVAILABLE",
                   **{infra.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items() if key != "isIpv6Enabled"}}
            calls = []
            elapsed = [0]
            def invoke(args):
                calls.append(args)
                if args[2] == "list":
                    return []
                if args[2] == "get" and sum(call[2] == "get" for call in calls) == 1:
                    raise OciError("get", "NotAuthorizedOrNotFound", 404)
                return row
            def wait(read, **kwargs):
                return wait_for_visible(read, **kwargs, clock=lambda: elapsed[0], sleep=lambda delay: elapsed.__setitem__(0, elapsed[0] + delay))
            with patch.object(infra, "JOURNAL", Path(directory) / "journal.json"), patch.object(infra, "invoke", side_effect=invoke), \
                    patch.object(infra, "wait_for_visible", side_effect=wait), contextlib.redirect_stdout(io.StringIO()):
                result = infra.create_one("vcn", journal, CHILD, payload, lambda: {"storage": "PASS"})
                self.assertEqual(result, row["id"])
                self.assertEqual(sum(call[2] == "create" for call in calls), 1)
                infra.create_one("vcn", journal, CHILD, payload, lambda: self.fail("No new create"))
                self.assertEqual(sum(call[2] == "create" for call in calls), 1)
            self.assertEqual(elapsed[0], 5)

    def test_identity_drift_and_unexpected_state_fail_closed(self):
        journal = {**fixture(), "created": {}}
        payload = infra.specification("vcn", journal, CHILD, AD)
        with self.assertRaises(KeySafetyError):
            infra.verify("vcn", {"spec": payload}, {"lifecycle-state": "AVAILABLE"})
        with self.assertRaises(KeySafetyError):
            infra.cli_arguments("delete", "create", payload={})
        with self.assertRaises(KeySafetyError):
            infra.cli_arguments("instance", "delete", payload={})

    def test_bastion_summary_field_names_map_to_get_model(self):
        journal = fixture()
        payload = infra.specification("bastion", journal, CHILD, AD)
        row = {infra.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items()}
        row["client-cidr-block-allow-list"] = row.pop("client-cidr-list")
        row["max-session-ttl-in-seconds"] = row.pop("max-session-ttl")
        row.update(id="ocid1.bastion.oc1.uk-london-1.controlledfixture01", **{"lifecycle-state": "ACTIVE"})
        self.assertEqual(infra.verify("bastion", {"spec": payload}, row), row["id"])

    def test_prospective_budget_uses_boundary_safe_decimal_text(self):
        report = {"region": "uk-london-1", "accountPaymentModel": "FREE_TRIAL", "checkedAt": datetime.now(timezone.utc).isoformat(),
                  "usage": {"instances": 0, "a1Ocpus": "0", "a1MemoryGB": "0", "liveVolumeGB": "0", "volumeBackups": 0},
                  "objectStorage": {"exactBytesProven": True, "approximateBytes": "0"}, "costReport": {"mayLag": True, "amounts": {}}}
        class Client:
            def read(self, *args, **kwargs):
                return [{"shape": infra.SHAPE, "billing-type": "LIMITED_FREE"}]
        with patch.object(infra, "inventory", return_value=report), patch.object(infra, "session_account_audit", return_value={}):
            result = infra.fresh_eligibility(Client(), {**fixture(), "created": {}}, AD)
        self.assertEqual(result["storage"]["proposedLiveVolumeGB"], "150")

    def test_pending_list_404_is_inside_wait_never_another_create(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = {**fixture(), "created": {}}
            payload = infra.specification("vcn", journal, CHILD, AD)
            journal["pending"] = {"kind": "vcn", "spec": payload, "id": "ocid1.vcn.oc1.uk-london-1.controlledfixture01"}
            row = {"id": journal["pending"]["id"], "lifecycle-state": "AVAILABLE",
                   **{infra.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items() if key != "isIpv6Enabled"}}
            calls = []
            elapsed = [0]
            def invoke(args):
                calls.append(args)
                self.assertNotEqual(args[2], "create")
                if len(calls) == 1:
                    raise OciError("list", "NotAuthorizedOrNotFound", 404)
                return [] if args[2] == "list" else row
            def wait(read, **kwargs):
                return wait_for_visible(read, **kwargs, clock=lambda: elapsed[0], sleep=lambda delay: elapsed.__setitem__(0, elapsed[0] + delay))
            with patch.object(infra, "JOURNAL", Path(directory) / "journal.json"), patch.object(infra, "invoke", side_effect=invoke), \
                    patch.object(infra, "wait_for_visible", side_effect=wait), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(infra.create_one("vcn", journal, CHILD, payload, lambda: self.fail("No new create")), row["id"])
            self.assertEqual(elapsed[0], 5)


if __name__ == "__main__":
    unittest.main()
