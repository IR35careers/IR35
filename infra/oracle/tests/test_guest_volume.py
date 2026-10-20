import copy
from pathlib import Path
import sys
import unittest
import subprocess
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import guest_volume as guest

UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def snapshot():
    return {"architecture": "aarch64", "blockdevices": [
        {"type": "disk", "path": "/dev/sda", "size": 50 * 1024 ** 3, "ro": False,
         "children": [{"fstype": "ext4", "mountpoints": ["/"]}]},
        {"type": "disk", "path": "/dev/sdb", "size": guest.BYTES, "ro": False, "mountpoints": [None], "fstype": None, "uuid": None}]}


class GuestVolumeTests(unittest.TestCase):
    def test_authoritative_probe_reuses_own_uuid_when_udev_cache_is_still_blank(self):
        disk = snapshot()["blockdevices"][1]
        self.assertFalse(guest.resolve_format_needed(disk, UUID, {"UUID": UUID, "TYPE": "ext4"}))
        self.assertTrue(guest.resolve_format_needed(disk, UUID, {}))
        for probe in ({"UUID": "foreign", "TYPE": "ext4"}, {"TYPE": "xfs"}):
            with self.assertRaises(RuntimeError):
                guest.resolve_format_needed(disk, UUID, probe)
        with self.assertRaises(RuntimeError):
            guest.resolve_format_needed({**disk, "fstype": "ext4", "uuid": UUID}, UUID, {})

    def test_reboot_check_never_mounts_to_manufacture_persistence(self):
        with patch.object(guest, "run", return_value=subprocess.CompletedProcess([], 1, "", "")) as run, \
                patch.object(guest.Path, "read_text", return_value="controlled-boot-id\n"):
            result = guest.mount_report(UUID, allow_unmounted=True)
        self.assertEqual(result, {"mounted": False, "bootId": "controlled-boot-id"})
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][0], "findmnt")

    def test_unique_blank_data_disk_never_selects_boot(self):
        disk, needed = guest.select_data_disk(snapshot(), UUID)
        self.assertTrue(needed)
        self.assertEqual(disk["path"], "/dev/sdb")

    def test_nonblank_root_partitioned_readonly_duplicate_or_foreign_uuid_never_formats(self):
        for changes in ({"mountpoints": ["/"]}, {"children": [{"type": "part"}]}, {"ro": True},
                        {"fstype": "ext4", "uuid": "foreign"}, {"path": "/dev/mapper/root"}, {"pkname": "sda"}):
            value = snapshot()
            value["blockdevices"][1].update(changes)
            with self.assertRaises(RuntimeError):
                guest.select_data_disk(value, UUID)
        duplicate = snapshot()
        duplicate["blockdevices"].append(copy.deepcopy(duplicate["blockdevices"][1]))
        with self.assertRaises(RuntimeError):
            guest.select_data_disk(duplicate, UUID)

    def test_only_recorded_ext4_uuid_can_be_reused_without_format(self):
        value = snapshot()
        value["blockdevices"][1].update(fstype="ext4", uuid=UUID, mountpoints=[guest.MOUNT])
        self.assertFalse(guest.select_data_disk(value, UUID)[1])
        with self.assertRaises(RuntimeError):
            guest.select_data_disk(value)

    def test_fstab_uuid_nofail_idempotent_preserves_root_and_rejects_conflict(self):
        original = "LABEL=cloudimg-rootfs / ext4 defaults 0 1\n"
        updated = guest.fstab_after(original, UUID)
        self.assertTrue(updated.startswith(original))
        self.assertIn("UUID=" + UUID + " " + guest.MOUNT + " ext4 defaults,nofail,", updated)
        self.assertEqual(guest.fstab_after(updated, UUID), updated)
        for line in ("/dev/sda " + guest.MOUNT + " ext4 defaults 0 2", "UUID=" + UUID + " /other ext4 defaults 0 2"):
            with self.assertRaises(RuntimeError):
                guest.fstab_after(original + line + "\n", UUID)


if __name__ == "__main__":
    unittest.main()
