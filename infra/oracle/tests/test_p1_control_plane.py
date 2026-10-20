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
        for target, value in (("JOURNAL", self.path), ("PREFLIGHT_RECEIPT", self.path.with_name("absent-preflight.json")), ("fresh_evidence", None)):
            item = patch.object(control, target, value) if target != "fresh_evidence" else patch.object(control, target, return_value={"selectedAD": AD})
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

    def test_owner_policy_is_at_root_targeting_ir35_exact_names(self):
        payload = control.spec("quota", ROOT, CHILD, AD, INTENT)
        self.assertEqual(payload["compartmentId"], ROOT)
        self.assertEqual(payload["name"], "ir35-always-free-cap")
        self.assertEqual(payload["description"], "Cap ir35 to Always Free envelope")
        self.assertEqual(payload["statements"], ["set compute-core quota standard-a1-core-count to 2 in compartment ir35",
            "set compute-memory quota standard-a1-memory-count to 12 in compartment ir35",
            "set block-storage quota total-storage-gb to 150 in compartment ir35"])

    def test_every_quota_crud_wire_is_limits_quota(self):
        payload = control.spec("quota", ROOT, CHILD, AD, INTENT)
        for args in (control.arguments("quota", payload), control.quota_read_arguments("list", root=ROOT),
                     control.quota_read_arguments("get", identifier="ocid1.quota.oc1..controlledfixture01")):
            self.assertEqual(args[:2], ["limits", "quota"])
        with self.assertRaises(KeySafetyError):
            control.quota_read_arguments("delete", root=ROOT)

    def test_definition_proof_rejects_wrong_name_support_or_scope(self):
        class Definitions:
            def read(self, operation, **selectors):
                names = ("standard-a1-core-count", "standard-a1-memory-count") if selectors["service"] == "compute" else ("total-storage-gb",)
                return [{"name": name, "scope-type": "AD", "are-quotas-supported": True} for name in names]
        self.assertEqual(len(control.verify_quota_names(Definitions())), 3)
        for bad in ([], [{"name": "standard-a1-core-count", "scope-type": "REGION", "are-quotas-supported": True}],
                    [{"name": "standard-a1-core-count", "scope-type": "AD", "are-quotas-supported": False}]):
            client = Definitions()
            client.read = lambda *args, **kwargs: bad
            with self.assertRaises(KeySafetyError):
                control.verify_quota_names(client)

    def quota_fixture(self):
        self.journal["created"] = {"compartment": {"id": CHILD}, "quota": {"id": "ocid1.quota.oc1..controlledfixture01"}}
        self.journal["selectedAD"] = AD
        class Effective:
            profile = {"tenancy": ROOT}
            domains = {AD}
            compartments = {ROOT, CHILD}
            calls = []
            polls = 0
            delayed = True
            def read(inner, operation, **selectors):
                inner.calls.append((operation, selectors))
                if operation == "quotas":
                    return [{"id": self.journal["created"]["quota"]["id"], "name": control.QUOTA_NAME,
                             "compartment-id": ROOT, "lifecycle-state": "ACTIVE"}]
                self.assertEqual(selectors["compartment"], CHILD)
                self.assertEqual(selectors["ad"], AD)
                if selectors["limit"] == "standard-a1-core-count":
                    inner.polls += 1
                values = {"standard-a1-core-count": 2, "standard-a1-memory-count": 12, "total-storage-gb": 150}
                return {"effective-quota-value": None if inner.delayed and inner.polls == 1 else values[selectors["limit"]]}
        return Effective()

    def test_wait_verifies_root_list_and_child_effective_limits_before_launch(self):
        client = self.quota_fixture()
        elapsed = [0]
        result = control.wait_for_quota(self.journal, client, clock=lambda: elapsed[0], sleep=lambda delay: elapsed.__setitem__(0, elapsed[0] + delay))
        self.assertEqual(result["polls"], 2)
        self.assertEqual(elapsed[0], 30)
        self.assertEqual(client.calls[0], ("quotas", {"compartment": ROOT}))
        self.assertEqual(result["limits"]["total-storage-gb"], "150")
        self.assertIn("aggregate executor guards still required", result["scope"])

    def test_propagation_timeout_never_creates_or_silently_passes(self):
        client = self.quota_fixture()
        original = client.read
        def never_ready(operation, **selectors):
            return original(operation, **selectors) if operation == "quotas" else {"effective-quota-value": None}
        client.read = never_ready
        ticks = iter([0, 600])
        with patch.object(control, "invoke") as mutate:
            with self.assertRaises(KeySafetyError) as error:
                control.wait_for_quota(self.journal, client, clock=lambda: next(ticks), sleep=lambda delay: self.fail("No sleep after deadline"))
            self.assertIn("within10minutes", str(error.exception))
            mutate.assert_not_called()

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
