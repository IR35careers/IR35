import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p1_compute as compute
import p1_infrastructure as infra
from key_ceremony import KeySafetyError
from visibility import OciError

AD = "fixture:UK-LONDON-1-AD-1"
CHILD = "ocid1.compartment.oc1..controlledfixture01"
IMAGE = "ocid1.image.oc1.uk-london-1.controlledfixture01"


class ComputeTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        item = patch.object(infra, "JOURNAL", Path(directory.name) / "journal.json")
        item.start()
        self.addCleanup(item.stop)
        self.journal = {"version": 1, "intent": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "ownerCIDR": "8.8.8.8/32",
                        "created": {kind: {"id": "ocid1." + infra.KINDS[kind][2] + ".oc1.uk-london-1.controlledfixture01"}
                                    for kind in ("vcn", "subnet", "nsg")}, "pending": None}
        self.elapsed = 0
    def sleep(self, delay):
        self.assertLessEqual(delay, 60)
        self.elapsed += delay
    def test_only_exact_capacity_rejection_allows_three_bounded_retries(self):
        class Client:
            domains = {AD, "fixture:UK-LONDON-1-AD-3"}
            def read(self, operation, **selectors):
                return {"available": 2 if selectors["limit"] == "standard-a1-core-count" else 12}
        calls = []
        def rejected(kind, journal, child, payload, gate):
            calls.append(payload["availabilityDomain"])
            journal["pending"] = {"kind": kind, "spec": payload}
            error = OciError("launch", "InternalError", 500)
            error.capacity = True
            raise error
        with patch.object(infra, "create_one", side_effect=rejected), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(KeySafetyError, "capacity limit exhausted"):
                compute.launch(self.journal, Client(), CHILD, AD, IMAGE, "ssh-ed25519 " + "A" * 68,
                               clock=lambda: self.elapsed, sleep=self.sleep)
        self.assertEqual(len(calls), 4)
        self.assertEqual(self.elapsed, 1800)
        self.assertEqual(len(self.journal["capacityRejectedIntents"]), 4)
        self.assertIsNone(self.journal["pending"])
        self.assertEqual(len(set(calls)), 2)
    def test_non_capacity_500_and_401_immediately_fail_no_retry(self):
        for status in (401, 500):
            self.journal.pop("capacity", None)
            with self.subTest(status=status), patch.object(infra, "create_one", side_effect=OciError("launch", "InternalError", status)) as create:
                with self.assertRaises(OciError):
                    compute.launch(self.journal, None, CHILD, AD, IMAGE, "ssh-ed25519 " + "A" * 68,
                                   clock=lambda: self.elapsed, sleep=self.sleep)
                self.assertEqual(create.call_count, 1)
                with self.assertRaisesRegex(KeySafetyError, "Previous non-capacity failure"):
                    compute.launch(self.journal, None, CHILD, AD, IMAGE, "ssh-ed25519 " + "A" * 68,
                                   clock=lambda: self.elapsed, sleep=self.sleep)
                self.assertEqual(create.call_count, 1)
        self.assertEqual(self.elapsed, 0)
    def test_pending_launch_reconciles_without_new_attempt(self):
        payload = infra.specification("instance", self.journal, CHILD, AD, IMAGE, "ssh-ed25519 " + "A" * 68)
        self.journal["pending"] = {"kind": "instance", "spec": payload}
        self.journal["capacity"] = {"startedAt": 0, "attempts": [{"at": 0, "ad": AD, "number": 1, "result": "pending"}]}
        with patch.object(infra, "create_one", side_effect=TimeoutError()) as reconcile:
            with self.assertRaises(TimeoutError):
                compute.launch(self.journal, None, CHILD, AD, IMAGE, "ssh-ed25519 " + "A" * 68,
                               clock=lambda: 30, sleep=self.sleep)
            self.assertEqual(reconcile.call_count, 1)
        self.assertEqual(len(self.journal["capacity"]["attempts"]), 1)
        self.assertIsNotNone(self.journal["pending"])

    def test_platform_image_only_not_custom_or_community(self):
        row = {"id": IMAGE, "lifecycle-state": "AVAILABLE", "operating-system": "Canonical Ubuntu", "operating-system-version": "24.04",
               "display-name": "Canonical-Ubuntu-24.04-aarch64-2026.09.18-0", "compartment-id": None, "listing-type": None}
        self.assertEqual(compute.official_image([row]), IMAGE)
        for changes in ({"compartment-id": CHILD}, {"listing-type": "COMMUNITY"}, {"operating-system-version": "22.04"}, {"display-name": "Ubuntu-Pro"}):
            with self.assertRaises(KeySafetyError):
                compute.official_image([{**row, **changes}])


if __name__ == "__main__":
    unittest.main()
