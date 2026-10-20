import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import p1_disk as disk
from key_ceremony import KeySafetyError
from visibility import wait_for_visible

UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


class DiskOrchestrationTests(unittest.TestCase):
    def test_reboot_wait_is_readonly_and_requires_changed_boot_plus_same_uuid(self):
        vm = "ocid1.instance.oc1.uk-london-1.controlledfixture01"
        journal = {"intent": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "created": {"instance": {"id": vm, "spec": {"compartmentId": "ocid1.compartment.oc1..controlledfixture01"}},
                   "volume": {"id": "ocid1.volume.oc1.uk-london-1.controlledfixture01"},
                   "attachment": {"id": "ocid1.volumeattachment.oc1.uk-london-1.controlledfixture01"}},
                   "dataMountIntent": {"uuid": UUID, "device": "/dev/sdb", "prepared": {"bootId": "old-boot"}, "rebootRequested": True}}
        answer = {"bootId": "new-boot", "mounted": True, "uuid": UUID, "mountpoint": "/opt/ir35/data", "filesystem": "ext4"}
        replies = [disk.host_ssh.SshNotReady("reboot connection refused"), {"bootId": "old-boot", "mounted": True},
                   {"bootId": "new-boot", "mounted": False}, answer]
        elapsed = [0]
        def wait(read, **kwargs):
            return wait_for_visible(read, **kwargs, clock=lambda: elapsed[0], sleep=lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds))
        with tempfile.TemporaryDirectory() as directory, patch.object(disk.infra, "JOURNAL", Path(directory) / "journal.json"), \
                patch.object(disk.finish, "attachment_prerequisite"), patch.object(disk.finish, "verify"), \
                patch.object(disk.infra, "invoke", return_value={}), patch.object(disk.infra, "verify"), \
                patch.object(disk.host_ssh, "run_remote", side_effect=replies) as remote, \
                patch.object(disk, "wait_for_visible", side_effect=wait), contextlib.redirect_stdout(io.StringIO()):
            disk.mount_and_reboot(journal)
        self.assertTrue(journal["guestMountComplete"])
        self.assertEqual(journal["dataMountIntent"]["rebootVerified"], answer)
        self.assertTrue(all(call.args[1] == ["post-reboot-status", UUID] for call in remote.call_args_list))

    def test_unresolved_host_hold_blocks_auth_and_all_guest_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            values = {
                "receipt": {"status": "PASS", "checkedAt": time.time(), "hostSSHSHA256": hashlib.sha256(Path(disk.host_ssh.__file__).read_bytes()).hexdigest()},
                "journal": {"stop": {"code": "ConsoleFingerprintMissing"}, "encryptionRepair": {"complete": True}},
                "control": {}}
            for name, value in values.items():
                (root / name).write_text(json.dumps(value))
                (root / name).chmod(0o600)
            with patch.object(disk, "KEY_DIRECTORY", root), patch.object(disk.control, "PREFLIGHT_RECEIPT", root / "receipt"), \
                    patch.object(disk.control, "JOURNAL", root / "control"), patch.object(disk.infra, "JOURNAL", root / "journal"), \
                    patch.object(disk.sys, "argv", ["disk.py", "mount-and-reboot"]), patch.object(disk, "ensure_session") as auth, \
                    patch.object(disk.host_ssh, "run_remote") as remote:
                with self.assertRaises(KeySafetyError):
                    disk.main()
                auth.assert_not_called()
                remote.assert_not_called()


if __name__ == "__main__":
    unittest.main()
