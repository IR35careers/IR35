import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p1_control_plane as control
from key_ceremony import KeySafetyError

ROOT = "ocid1.tenancy.oc1..controlledfixture01"
CHILD = "ocid1.compartment.oc1..controlledfixture01"
AD = "fixture:UK-LONDON-1-AD-1"
INTENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


class Client:
    profile = {"tenancy": ROOT}
    def __init__(self, collisions=None):
        self.collisions = collisions or []
        self.compartments = {ROOT}
    def read(self, operation, **selectors):
        return self.collisions


class ControlPlaneTests(unittest.TestCase):
    def test_failed_preflight_holds_real_entrypoint_before_any_operation(self):
        with patch.object(control, "create_one") as create, patch.object(control, "ensure_session") as auth:
            with self.assertRaises(KeySafetyError):
                control.main()
            create.assert_not_called()
            auth.assert_not_called()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "journal.json"
        self.journal = {"version": 1, "created": {}, "pending": None, "selectedAD": None}
        for target, value in (("JOURNAL", self.path), ("fresh_evidence", None)):
            item = patch.object(control, target, value) if target == "JOURNAL" else patch.object(control, target, return_value={"selectedAD": AD})
            item.start()
            self.addCleanup(item.stop)

    def test_only_compartment_and_quota_specs_no_generic_operation(self):
        for kind in ("instance", "bucket", "vcn", "raw-request", "delete", "update"):
            with self.assertRaises(KeySafetyError):
                control.spec(kind, ROOT, CHILD, AD, INTENT)
            with self.assertRaises(KeySafetyError):
                control.arguments(kind, {})
        payload = control.spec("compartment", ROOT, None, AD, INTENT)
        args = control.arguments("compartment", payload)
        self.assertEqual(args[:3], ["iam", "compartment", "create"])
        self.assertIn("--compartment-id", args)
        self.assertIn("--freeform-tags", args)

    def test_quota_families_zero_by_default_one_ad_only(self):
        statements = control.quota_statements(AD)
        self.assertEqual(statements[:3], ["zero compute-core quotas in compartment ir35",
                                          "zero compute-memory quotas in compartment ir35",
                                          "zero block-storage quotas in compartment ir35"])
        self.assertIn(" to 2 in compartment ir35 where request.ad=" + AD, statements[3])
        self.assertIn(" to 12 in compartment ir35 where request.ad=" + AD, statements[4])
        self.assertIn(" to 150 in compartment ir35 where request.ad=" + AD, statements[5])
        self.assertEqual(statements[6], "set block-storage quota backup-count to 5 in compartment ir35")
        self.assertFalse(any(" in tenancy" in item for item in statements))
        for ad in ("--debug", "fixture:OTHER-AD-1", "fixture:UK-LONDON-1-AD-1 or true"):
            with self.assertRaises(KeySafetyError):
                control.quota_statements(ad)

    def test_durable_intent_precedes_create_and_independent_get(self):
        calls = []
        def invoke(args):
            calls.append(args)
            intent = json.loads(self.path.read_text())["pending"]
            self.assertEqual(intent["kind"], "compartment")
            return {"id": CHILD, "name": "ir35", "compartment-id": ROOT, "freeform-tags": intent["spec"]["freeformTags"], "lifecycle-state": "ACTIVE"}
        with patch.object(control, "invoke", side_effect=invoke):
            self.assertEqual(control.create_one("compartment", self.journal, Client()), CHILD)
        self.assertEqual(calls[0][:3], ["iam", "compartment", "create"])
        self.assertEqual(calls[1], ["iam", "compartment", "get", "--compartment-id", CHILD])
        result = json.loads(self.path.read_text())
        self.assertIsNone(result["pending"])
        self.assertEqual(result["created"]["compartment"]["id"], CHILD)

    def test_unknown_create_retains_intent_and_never_retries(self):
        with patch.object(control, "invoke", side_effect=TimeoutError()) as invoke:
            with self.assertRaises(TimeoutError):
                control.create_one("compartment", self.journal, Client())
            self.assertIsNotNone(json.loads(self.path.read_text())["pending"])
            with self.assertRaises(KeySafetyError):
                control.create_one("compartment", self.journal, Client())
            self.assertEqual(invoke.call_count, 1)

    def test_collision_and_mismatched_readback_are_hard_stops(self):
        with patch.object(control, "invoke") as invoke:
            with self.assertRaises(KeySafetyError):
                control.create_one("compartment", self.journal, Client([{"name": "ir35", "lifecycle-state": "ACTIVE"}]))
            invoke.assert_not_called()
        payload = control.spec("quota", ROOT, CHILD, AD, INTENT)
        result = {"id": "ocid1.quota.oc1..controlledfixture01", "name": payload["name"], "compartment-id": CHILD,
                  "freeform-tags": payload["freeformTags"], "lifecycle-state": "ACTIVE", "statements": []}
        with self.assertRaises(KeySafetyError):
            control.check_readback("quota", payload, result)


if __name__ == "__main__":
    unittest.main()
