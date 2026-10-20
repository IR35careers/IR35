import contextlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import hashlib
import json
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p1_finish as finish
import p1_infrastructure as infra
from key_ceremony import KeySafetyError
from visibility import OciError, wait_for_visible

CHILD = "ocid1.compartment.oc1..controlledfixture01"


def fixture():
    return {"intent": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "created": {
        "instance": {"id": "ocid1.instance.oc1.uk-london-1.controlledfixture01"},
        "volume": {"id": "ocid1.volume.oc1.uk-london-1.controlledfixture01"},
        "topic": {"id": "ocid1.onstopic.oc1.uk-london-1.controlledfixture01"}}, "pending": None}


class FinishTests(unittest.TestCase):
    def test_pending_bucket_reconciles_before_completed_associations(self):
        self.assertEqual(finish.reconciliation_order({"pending": {"kind": "bucket"}}),
                         ("bucket", "attachment", "topic", "subscription"))
        self.assertEqual(finish.reconciliation_order({}), ("attachment", "topic", "subscription", "bucket"))
        with self.assertRaisesRegex(KeySafetyError, "Unknown pending"):
            finish.reconciliation_order({"pending": {"kind": "unknown"}})
    def test_unproven_mount_blocks_remaining_creates_before_auth(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = root / "receipt.json"
            receipt.write_text(json.dumps({"status": "PASS", "checkedAt": time.time(), "finishSHA256": hashlib.sha256(Path(finish.__file__).read_bytes()).hexdigest()}))
            receipt.chmod(0o600)
            journal = root / "journal.json"
            journal.write_text(json.dumps({"guestMountComplete": False}))
            journal.chmod(0o600)
            with patch.object(finish, "KEY_DIRECTORY", root), patch.object(infra, "JOURNAL", journal), \
                    patch.object(finish.control, "PREFLIGHT_RECEIPT", receipt), patch.object(finish.sys, "argv", ["finish.py", "provision"]), \
                    patch.object(finish, "ensure_session") as auth, patch.object(infra, "invoke") as invoke:
                with self.assertRaisesRegex(KeySafetyError, "reboot persistence required"):
                    finish.main()
                auth.assert_not_called()
                invoke.assert_not_called()

    def test_real_failure_hold_blocks_entrypoint_before_auth_or_any_oci_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = root / "receipt.json"
            receipt.write_text(json.dumps({"status": "PASS", "checkedAt": time.time(),
                               "finishSHA256": hashlib.sha256(Path(finish.__file__).read_bytes()).hexdigest()}))
            receipt.chmod(0o600)
            journal = root / "journal.json"
            journal.write_text(json.dumps({"stop": {"code": "InvalidParameter", "status": 400}}))
            journal.chmod(0o600)
            with patch.object(finish, "KEY_DIRECTORY", root), patch.object(infra, "JOURNAL", journal), \
                    patch.object(finish.control, "PREFLIGHT_RECEIPT", receipt), patch.object(finish.sys, "argv", ["finish.py", "provision"]), \
                    patch.object(finish, "ensure_session") as auth, patch.object(infra, "invoke") as invoke:
                with self.assertRaisesRegex(KeySafetyError, "held on recorded real failure"):
                    finish.main()
                auth.assert_not_called()
                invoke.assert_not_called()
    def test_backup_bucket_strictly_private_standard_no_versions_or_tiering(self):
        payload = finish.spec("bucket", fixture(), CHILD, "controlledfixture")
        self.assertEqual((payload["publicAccessType"], payload["storageTier"], payload["versioning"], payload["autoTiering"]),
                         ("NoPublicAccess", "Standard", "Disabled", "Disabled"))
        self.assertFalse(payload["objectEventsEnabled"])
    def test_pending_bucket_requests_tags_and_reuses_without_create(self):
        journal = fixture()
        payload = finish.spec("bucket", journal, CHILD, "controlledfixture")
        identifier = "ocid1.bucket.oc1.uk-london-1.controlledfixture01"
        journal["pending"] = {"kind": "bucket", "spec": payload, "id": identifier}
        row = {infra.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items()}
        row["namespace"] = row.pop("namespace-name")
        row["id"] = identifier
        def invoke(arguments):
            self.assertIn(arguments[2], ("list", "get"))
            if arguments[2] == "list":
                self.assertEqual(arguments[arguments.index("--fields") + 1], "tags")
                # OCI BucketSummary omits id and the full bucket configuration.
                return [{key: row[key] for key in ("name", "namespace", "compartment-id", "freeform-tags")}]
            return row
        with tempfile.TemporaryDirectory() as directory, patch.object(infra, "JOURNAL", Path(directory) / "journal.json"), \
                patch.object(infra, "invoke", side_effect=invoke), contextlib.redirect_stdout(io.StringIO()):
            finish.create_one("bucket", journal, CHILD, payload, lambda: self.fail("No duplicate create"))
        self.assertEqual(journal["created"]["bucket"]["id"], identifier)
        self.assertIsNone(journal["pending"])
    def test_bucket_summary_without_ocid_never_creates_and_get_must_match_pending_id(self):
        journal = fixture()
        payload = finish.spec("bucket", journal, CHILD, "controlledfixture")
        identifier = "ocid1.bucket.oc1.uk-london-1.controlledfixture01"
        row = {infra.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items()}
        row["namespace"] = row.pop("namespace-name")
        row["id"] = identifier
        summary = {key: row[key] for key in ("name", "namespace", "compartment-id", "freeform-tags")}
        def invoke(arguments):
            self.assertIn(arguments[2], ("list", "get"))
            return [summary] if arguments[2] == "list" else row
        with tempfile.TemporaryDirectory() as directory, patch.object(infra, "JOURNAL", Path(directory) / "journal.json"), \
                patch.object(infra, "invoke", side_effect=invoke), contextlib.redirect_stdout(io.StringIO()):
            finish.create_one("bucket", journal, CHILD, payload, lambda: self.fail("Existing bucket cannot create"))
            self.assertEqual(journal["created"]["bucket"]["id"], identifier)
            journal["created"]["bucket"]["id"] = "ocid1.bucket.oc1.uk-london-1.differentfixture01"
            with self.assertRaisesRegex(KeySafetyError, "identity mismatch"):
                finish.create_one("bucket", journal, CHILD, payload, lambda: self.fail("Cannot create"))
        self.assertIsNone(journal["pending"])
    def test_attachment_is_exact_tagged_parent_pair_not_a_new_volume(self):
        journal = fixture()
        payload = finish.spec("attachment", journal, CHILD, "controlledfixture")
        self.assertEqual(payload["volumeId"], journal["created"]["volume"]["id"])
        self.assertEqual(payload["instanceId"], journal["created"]["instance"]["id"])
        self.assertTrue(payload["isPvEncryptionInTransitEnabled"])
        self.assertFalse(payload["isShareable"])
        self.assertFalse(payload["isReadOnly"])
        pending = {infra.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items()
                   if key in ("displayName", "instanceId", "volumeId")}
        pending["lifecycle-state"] = "ATTACHING"
        self.assertIsNone(finish.verify("attachment", payload, pending))
    def test_subscription_pending_is_not_claimed_email_delivery(self):
        payload = finish.spec("subscription", fixture(), CHILD, "controlledfixture")
        row = {infra.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items()}
        row["endpoint"] = row.pop("subscription-endpoint")
        row.update(id="ocid1.onssubscription.oc1.uk-london-1.controlledfixture01", **{"lifecycle-state": "PENDING"})
        self.assertEqual(finish.verify("subscription", payload, row), row["id"])
        with self.assertRaises(KeySafetyError):
            finish.verify("subscription", payload, {**row, "endpoint": "different@example.test"})
    def test_pending_topic_404_then_get_reconciles_without_create(self):
        journal = fixture()
        payload = finish.spec("topic", journal, CHILD, "controlledfixture")
        journal["created"].pop("topic")
        journal["pending"] = {"kind": "topic", "spec": payload, "id": "ocid1.onstopic.oc1.uk-london-1.controlledfixture01"}
        row = {infra.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items()}
        row.update(**{"topic-id": journal["pending"]["id"], "lifecycle-state": "ACTIVE"})
        calls = []
        elapsed = [0]
        def invoke(args):
            calls.append(args)
            self.assertNotEqual(args[2], "create")
            if len(calls) == 1:
                raise OciError("get", "NotAuthorizedOrNotFound", 404)
            return [] if args[2] == "list" else row
        def wait(read, **kwargs):
            return wait_for_visible(read, **kwargs, clock=lambda: elapsed[0], sleep=lambda delay: elapsed.__setitem__(0, elapsed[0] + delay))
        with tempfile.TemporaryDirectory() as directory, patch.object(infra, "JOURNAL", Path(directory) / "journal.json"), \
                patch.object(infra, "invoke", side_effect=invoke), patch.object(finish, "wait_for_visible", side_effect=wait), contextlib.redirect_stdout(io.StringIO()):
            finish.create_one("topic", journal, CHILD, payload, lambda: self.fail("No new create"))
        self.assertEqual(elapsed[0], 5)
        self.assertIsNone(journal["pending"])


if __name__ == "__main__":
    unittest.main()
