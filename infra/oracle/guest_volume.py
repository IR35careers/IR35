"""Controlled guest data-volume operations; no OCI/cloud/application secrets."""
import json
import fcntl
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid as uuid_module

MOUNT = "/opt/ir35/data"
BYTES = 100 * 1024 ** 3


def inspect():
    result = subprocess.run(["lsblk", "--json", "--bytes", "--output", "NAME,PATH,TYPE,SIZE,FSTYPE,UUID,MOUNTPOINTS,PKNAME,SERIAL,WWN,MODEL,RO"],
                            capture_output=True, text=True, check=True, timeout=10)
    return {"architecture": os.uname().machine, "blockdevices": json.loads(result.stdout)["blockdevices"]}


def canonical_uuid(value):
    if str(uuid_module.UUID(value)) != value or uuid_module.UUID(value).version != 4:
        raise RuntimeError("Expected the recorded canonical UUID4 data-mount intent")
    return value


def select_data_disk(snapshot, expected_uuid=None):
    if snapshot.get("architecture") != "aarch64":
        raise RuntimeError("Expected the approved ARM64 staging guest")
    if expected_uuid:
        canonical_uuid(expected_uuid)
    disks = [row for row in snapshot.get("blockdevices", []) if row.get("type") == "disk" and row.get("size") == BYTES]
    if len(disks) != 1:
        raise RuntimeError("Expected exactly one whole 100GiB data disk; no format target selected")
    disk = disks[0]
    mounted = [value for value in disk.get("mountpoints", []) if value]
    if (disk.get("children") or disk.get("ro") is not False or disk.get("pkname")
            or not re.fullmatch(r"/dev/(?:[sv]d[a-z]|nvme[0-9]+n[0-9]+)", disk.get("path", ""))):
        raise RuntimeError("Data disk is partitioned, read-only or ambiguous; no format")
    if disk.get("fstype") == "ext4" and expected_uuid and disk.get("uuid") == expected_uuid:
        if any(value != MOUNT for value in mounted):
            raise RuntimeError("Recorded data UUID is mounted elsewhere; no mutation")
        return disk, False
    if disk.get("fstype") or disk.get("uuid") or mounted:
        raise RuntimeError("Data candidate has existing filesystem/UUID/mount; never overwrite")
    return disk, True


def fstab_after(text, identifier):
    canonical_uuid(identifier)
    source = "UUID=" + identifier
    expected = source + " " + MOUNT + " ext4 defaults,nofail,x-systemd.device-timeout=30 0 2"
    matching = []
    for line in text.splitlines():
        fields = line.split("#", 1)[0].split()
        if fields and (fields[0] == source or len(fields) > 1 and fields[1] == MOUNT):
            matching.append(" ".join(fields))
    if matching:
        if matching != [expected]:
            raise RuntimeError("Conflicting data fstab entry; no replacement or duplicate")
        return text
    return text.rstrip("\n") + "\n" + expected + "\n"


def run(arguments, timeout=15, *, accepted=(0,)):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode not in accepted:
        raise RuntimeError("Guest " + arguments[0] + " failed; raw output suppressed")
    return result


def blank_signatures(path):
    signatures = json.loads(run(["wipefs", "--no-act", "--json", path]).stdout)
    if signatures.get("signatures") != []:
        raise RuntimeError("Data disk signature detected; no format")
    result = run(["blkid", "-p", "-o", "export", path], accepted=(0, 2))
    if result.returncode != 2 or result.stdout.strip():
        raise RuntimeError("Data disk is not proven blank; no format")


def filesystem_probe(path):
    result = run(["blkid", "-p", "-o", "export", path], accepted=(0, 2))
    if result.returncode == 2:
        if result.stdout.strip():
            raise RuntimeError("Unexpected blank filesystem probe; no mutation")
        return {}
    values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if values.get("DEVNAME", path) != path:
        raise RuntimeError("Filesystem probe returned another device; no mutation")
    return {key: values[key] for key in ("UUID", "TYPE") if key in values}


def resolve_format_needed(disk, identifier, probe):
    if probe == {"UUID": identifier, "TYPE": "ext4"}:
        return False  # Own recorded filesystem, even when udev still says blank.
    if probe or disk.get("fstype") or disk.get("uuid"):
        raise RuntimeError("Authoritative filesystem probe differs from recorded intent; never reformat")
    return True


def diagnose_recorded(identifier, expected_device):
    canonical_uuid(identifier)
    value = inspect()
    rows = [row for row in value["blockdevices"] if row.get("type") == "disk" and row.get("size") == BYTES and row.get("path") == expected_device]
    if value["architecture"] != "aarch64" or len(rows) != 1 or not re.fullmatch(r"/dev/(?:[sv]d[a-z]|nvme[0-9]+n[0-9]+)", expected_device):
        raise RuntimeError("Recorded diagnostic target is not the unique ARM100GiB data device")
    probe = filesystem_probe(expected_device)
    return {"device": expected_device, "size": rows[0]["size"], "cachedFilesystem": rows[0].get("fstype"), "cachedUuid": rows[0].get("uuid"),
            "probe": probe, "recordedUuidMatches": probe.get("UUID") == identifier, "formatRetried": False}


def mount_report(identifier, allow_unmounted=False):
    canonical_uuid(identifier)
    found = run(["findmnt", "--json", "--mountpoint", MOUNT, "--output", "TARGET,SOURCE,FSTYPE,UUID,OPTIONS"], accepted=(0, 1) if allow_unmounted else (0,))
    boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    if allow_unmounted and found.returncode == 1:
        return {"mounted": False, "bootId": boot_id}
    result = json.loads(found.stdout)
    rows = result.get("filesystems", [])
    if len(rows) != 1 or rows[0].get("target") != MOUNT or rows[0].get("fstype") != "ext4" or rows[0].get("uuid") != identifier:
        raise RuntimeError("Data volume is not already mounted at the exact UUID/ext4 target")
    if "rw" not in rows[0].get("options", "").split(","):
        raise RuntimeError("Expected writable data mount")
    return {"mounted": True, "uuid": identifier, "device": rows[0]["source"], "filesystem": "ext4", "mountpoint": MOUNT,
            "bootId": boot_id,
            "df": run(["df", "-h", "--output=source,fstype,size,used,avail,pcent,target", MOUNT]).stdout.strip()}


def prepare(identifier, expected_device):
    canonical_uuid(identifier)
    if os.geteuid() != 0:
        raise RuntimeError("Root-only fixed data volume setup")
    descriptor = os.open("/run/lock/ir35-data-volume.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        disk, format_needed = select_data_disk(inspect(), identifier)
        path = disk["path"]
        if path != expected_device:
            raise RuntimeError("Guest data device differs from the recorded inspection target; no format")
        for directory in (Path("/opt"), Path("/opt/ir35"), Path(MOUNT)):
            if directory.is_symlink():
                raise RuntimeError("Data target path traverses a symlink; no mutation")
        target = Path(MOUNT)
        if target.is_mount():
            mount_report(identifier)
        if target.exists() and not target.is_mount() and any(target.iterdir()):
            raise RuntimeError("Unmounted data directory is nonempty; do not hide existing files")
        fstab = Path("/etc/fstab")
        if fstab.is_symlink() or not fstab.is_file():
            raise RuntimeError("Unexpected fstab type; no mutation")
        original = fstab.read_text()
        updated = fstab_after(original, identifier)
        format_needed = resolve_format_needed(disk, identifier, filesystem_probe(path))
        if format_needed:
            blank_signatures(path)
            # No -F/force: the unique blank whole disk and UUID intent were
            # independently checked; an existing filesystem is never overwritten.
            run(["mkfs.ext4", "-U", identifier, "-L", "ir35-data", "-m", "1", path], timeout=180)
            if filesystem_probe(path) != {"UUID": identifier, "TYPE": "ext4"}:
                raise RuntimeError("Formatted data UUID/device readback differs; no mount")
        # mkfs does not synchronously update the udev/lsblk cache. Verify the
        # filesystem directly, then refresh only this disk's UUID symlink/cache.
        run(["udevadm", "trigger", "--action=change", "--subsystem-match=block", "--sysname-match=" + Path(path).name])
        run(["udevadm", "settle", "--timeout=15"], timeout=20)
        if original != updated:
            backup = Path("/etc/fstab.ir35-before-data")
            if not backup.exists():
                backup_fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(backup_fd, "w") as stream:
                    stream.write(original)
                    stream.flush()
                    os.fsync(stream.fileno())
            temporary_fd, temporary_path = tempfile.mkstemp(prefix=".ir35-fstab-", dir="/etc")
            with os.fdopen(temporary_fd, "w") as stream:
                os.fchmod(stream.fileno(), 0o644)
                stream.write(updated)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_path, fstab)
            run(["systemctl", "daemon-reload"])
        target.mkdir(parents=True, exist_ok=True)
        if not target.is_mount():
            run(["mount", MOUNT], timeout=40)
        report = mount_report(identifier)
        report["formatPerformed"] = format_needed
        return report
    finally:
        os.close(descriptor)


def schedule_reboot():
    boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    run(["systemd-run", "--unit=ir35-data-mount-reboot", "--on-active=5", "/usr/bin/systemctl", "reboot"])
    return {"rebootScheduled": True, "bootId": boot_id}


def main():
    arguments = sys.argv[1:]
    if arguments == ["inspect"]:
        result = inspect()
    elif len(arguments) == 3 and arguments[0] == "prepare":
        result = prepare(arguments[1], arguments[2])
    elif len(arguments) == 2 and arguments[0] == "verify-mounted":
        # Deliberately never calls mount: reboot verification must prove fstab.
        result = mount_report(arguments[1])
    elif len(arguments) == 2 and arguments[0] == "post-reboot-status":
        result = mount_report(arguments[1], allow_unmounted=True)
    elif len(arguments) == 3 and arguments[0] == "diagnose-recorded":
        result = diagnose_recorded(arguments[1], arguments[2])
    elif arguments == ["schedule-reboot"]:
        result = schedule_reboot()
    else:
        raise RuntimeError("Fixed guest volume operation only")
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, RuntimeError) else "Guest command failed; raw output suppressed"}))
        raise SystemExit(1)
