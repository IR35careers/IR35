import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p1_encryption as repair
import p1_finish as finish
import p1_infrastructure as infra
from key_ceremony import KeySafetyError
from visibility import OciError, service_error_detail

CHILD = "ocid1.compartment.oc1..controlledfixture01"
INSTANCE = "ocid1.instance.oc1.uk-london-1.controlledfixture01"
VOLUME = "ocid1.volume.oc1.uk-london-1.controlledfixture01"
IMAGE = "ocid1.image.oc1.uk-london-1.controlledfixture01"


def inputs(enabled):
    instance = {"id": INSTANCE, "shape": infra.SHAPE, "image-id": IMAGE,
                "launch-options": {"is-pv-encryption-in-transit-enabled": enabled, "remote-data-volume-type": "PARAVIRTUALIZED", "boot-volume-type": "PARAVIRTUALIZED"}}
    image = {"id": IMAGE, "compartment-id": None, "operating-system": "Canonical Ubuntu", "operating-system-version": "24.04", "display-name": "Canonical-Ubuntu-24.04-aarch64-2026.09.18-0"}
    journal = {"intent": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "created": {"instance": {"id": INSTANCE}, "volume": {"id": VOLUME}}, "pending": None}
    return instance, image, journal, finish.spec("attachment", journal, CHILD, "unused")


class EncryptionTests(unittest.TestCase):
    def test_new_host_trust_failure_cannot_be_cleared_by_old_encryption_repair(self):
        journal = {"stop": {"kind": "sshHostTrust", "code": "ConsoleFingerprintMissing", "realFailure": True}}
        with patch.object(infra, "invoke") as api:
            with self.assertRaisesRegex(KeySafetyError, "different real failure"):
                repair.repair(journal, {}, None)
            api.assert_not_called()
        self.assertEqual(journal["stop"]["code"], "ConsoleFingerprintMissing")

    def test_false_instance_flag_blocks_before_any_attachment_api_call(self):
        instance, image, journal, payload = inputs(False)
        with patch.object(infra, "invoke") as api:
            with self.assertRaisesRegex(KeySafetyError, "instance launchOptions.isPvEncryptionInTransitEnabled must be true"):
                finish.create_one("attachment", journal, CHILD, payload, lambda: {},
                                  prerequisite=lambda: finish.check_attachment_prerequisite(instance, image, payload))
            api.assert_not_called()
        self.assertIsNone(journal["pending"])

    def test_happy_encrypted_path_creates_once_and_second_call_reuses(self):
        instance, image, journal, payload = inputs(True)
        attachment = "ocid1.volumeattachment.oc1.uk-london-1.controlledfixture01"
        row = {infra.re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key): value for key, value in payload.items()}
        row.update(id=attachment, **{"lifecycle-state": "ATTACHED", "attachment-type": "paravirtualized"})
        calls = []
        def api(args):
            calls.append(args)
            return [] if args[2] == "list" else row
        with tempfile.TemporaryDirectory() as directory, patch.object(infra, "JOURNAL", Path(directory) / "journal.json"), \
                patch.object(infra, "invoke", side_effect=api), contextlib.redirect_stdout(io.StringIO()):
            for _ in range(2):
                finish.create_one("attachment", journal, CHILD, payload, lambda: {"storage": "PASS"},
                                  prerequisite=lambda: finish.check_attachment_prerequisite(instance, image, payload))
        self.assertEqual(sum(args[2] == "attach-paravirtualized-volume" for args in calls), 1)
        self.assertEqual(journal["created"]["attachment"]["id"], attachment)

    def test_custom_image_iscsi_and_unencrypted_request_rejected(self):
        instance, image, _, payload = inputs(True)
        for altered_instance, altered_image, altered_payload in (
                (instance, {**image, "compartment-id": CHILD}, payload),
                ({**instance, "launch-options": {"remote-data-volume-type": "ISCSI", "is-pv-encryption-in-transit-enabled": True}}, image, payload),
                (instance, image, {**payload, "isPvEncryptionInTransitEnabled": False})):
            with self.assertRaises(KeySafetyError):
                finish.check_attachment_prerequisite(altered_instance, altered_image, altered_payload)
        self.assertTrue(repair.platform_pv(instance, image))

    def test_update_wire_changes_only_instance_encryption(self):
        args = repair.update_arguments(INSTANCE)
        self.assertEqual(args[:3], ["compute", "instance", "update"])
        self.assertEqual(json.loads(args[args.index("--launch-options") + 1]), {"isPvEncryptionInTransitEnabled": True})
        self.assertNotIn("--shape", args)

    def test_boot_list_actual_instance_id_type_and_exact_parent_pair(self):
        row = {"id": INSTANCE, "instance-id": INSTANCE, "boot-volume-id": "ocid1.bootvolume.oc1.uk-london-1.controlledfixture01",
               "lifecycle-state": "ATTACHED", "is-pv-encryption-in-transit-enabled": True}
        report = repair.boot_encryption_report(row, INSTANCE, row["boot-volume-id"])
        self.assertTrue(report["isPvEncryptionInTransitEnabled"])
        with self.assertRaises(KeySafetyError):
            repair.boot_encryption_report({**row, "instance-id": "wrong"}, INSTANCE, row["boot-volume-id"])

    def test_full_service_diagnostic_redacts_credentials_but_preserves_reason(self):
        message = 'Instance prerequisite is false; password="private sentinel" token=secret-sentinel Bearer abc-secret postgresql://user:pass@db {"password": "json-sentinel", "client_secret": "oauth-sentinel"}'
        detail = service_error_detail(json.dumps({"message": message, "headers": "do not export"}), OciError("attach", "InvalidParameter", 400))
        self.assertIn("Instance prerequisite is false", detail["message"])
        for secret in ("private sentinel", "secret-sentinel", "abc-secret", "user:pass", "json-sentinel", "oauth-sentinel", "do not export"):
            self.assertNotIn(secret, json.dumps(detail))
        self.assertEqual(detail["status"], 400)


if __name__ == "__main__":
    unittest.main()
