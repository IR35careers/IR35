#!/usr/bin/env python3
"""Pin VM SSH host identity, then inspect before any filesystem mutation."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import sys
import time
import uuid

from key_ceremony import KeySafetyError
from bootstrap_audit import KEY_DIRECTORY
import host_ssh
import guest_volume
import p1_finish as finish
import p1_control_plane as control
import p1_infrastructure as infra
from resource_audit import ReadOnlyOci
from security_session import atomic_metadata, ensure_session, private_file
from visibility import wait_for_visible


def mount_and_reboot(journal):
    attachment = finish.spec("attachment", journal, journal["created"]["instance"]["spec"]["compartmentId"], "unused")
    finish.attachment_prerequisite(journal, attachment)
    observed = infra.invoke(finish.args("attachment", "get", attachment, "unused", journal["created"]["attachment"]["id"]))
    finish.verify("attachment", attachment, observed)
    volume = infra.invoke(infra.cli_arguments("volume", "get", resource_id=infra.identifier(journal, "volume")))
    infra.verify("volume", journal["created"]["volume"], volume)
    source = Path(guest_volume.__file__).read_text()
    if not journal.get("dataMountIntent"):
        if not journal.get("guestDiskInspection"):
            raise KeySafetyError("Actual guest disk inspection is required before a mount intent.")
        disk, needed = guest_volume.select_data_disk(journal["guestDiskInspection"])
        if not needed:
            raise KeySafetyError("New volume must be proven blank before recording format intent.")
        journal["dataMountIntent"] = {"uuid": str(uuid.uuid4()), "device": disk["path"], "mountpoint": "/opt/ir35/data"}
        atomic_metadata(infra.JOURNAL, journal)
    entry = journal["dataMountIntent"]
    if not entry.get("prepared"):
        diagnostic = entry.get("readbackDiagnostic")
        if diagnostic:
            if (diagnostic.get("device") != entry["device"] or diagnostic.get("recordedUuidMatches") is not True
                    or diagnostic.get("probe") != {"UUID": entry["uuid"], "TYPE": "ext4"}):
                raise KeySafetyError("Existing format readback mismatch is not resolved; no format/mount retry.")
            entry["readbackRepair"] = {"authoritativeUuidMatched": True, "reformatPermitted": False}
            atomic_metadata(infra.JOURNAL, journal)
        result = host_ssh.run_remote(source, ["prepare", entry["uuid"], entry["device"]], timeout=240)
        if diagnostic and result.get("formatPerformed") is not False:
            raise KeySafetyError("Recorded existing filesystem must never be reformatted.")
        if result.get("uuid") != entry["uuid"] or result.get("mountpoint") != "/opt/ir35/data" or result.get("mounted") is not True:
            raise KeySafetyError("Guest mount UUID/target readback mismatch.")
        entry["prepared"] = result
        atomic_metadata(infra.JOURNAL, journal)
        print("PASS: exact new blank data disk ext4/recordedUUID/nofail mounted; reboot persistence remains unproven.", flush=True)
    old_boot = entry["prepared"]["bootId"]
    if not entry.get("rebootRequested"):
        entry["rebootRequested"] = True
        atomic_metadata(infra.JOURNAL, journal)
        # Durable intent first; never schedules a second reboot on ambiguity.
        try:
            result = host_ssh.run_remote(source, ["schedule-reboot"])
            if result.get("rebootScheduled") is not True or result.get("bootId") != old_boot:
                raise KeySafetyError("Reboot scheduling readback differs; no second reboot.")
        except host_ssh.SshNotReady:
            entry["rebootSchedulingAmbiguous"] = True
        atomic_metadata(infra.JOURNAL, journal)
    def persisted():
        try:
            result = host_ssh.run_remote(source, ["post-reboot-status", entry["uuid"]], timeout=45)
        except host_ssh.SshNotReady:
            return None
        if result.get("bootId") == old_boot or result.get("mounted") is False:
            return None
        if result.get("mounted") is not True or result.get("uuid") != entry["uuid"] or result.get("mountpoint") != "/opt/ir35/data":
            raise KeySafetyError("Reboot mount proof differs; never remount to manufacture a PASS.")
        return result
    result = wait_for_visible(persisted, label="guest-uuid-reboot-mount")
    entry["rebootVerified"] = result
    journal["guestMountComplete"] = True
    atomic_metadata(infra.JOURNAL, journal)
    print("PASS: bootID changed; exact UUID/ext4 mount survived reboot without a manual mount. " + json.dumps(result), flush=True)


def main():
    if sys.argv[1:] not in (["inspect"], ["mount-and-reboot"], ["diagnose-format"]):
        raise KeySafetyError("Fixed disk inspect or approved new-data mount/reboot only.")
    receipt = json.loads(private_file(control.PREFLIGHT_RECEIPT))
    if (receipt.get("status") != "PASS" or not 0 <= time.time() - receipt["checkedAt"] <= 1800
            or receipt.get("hostSSHSHA256") != hashlib.sha256(Path(host_ssh.__file__).read_bytes()).hexdigest()):
        raise KeySafetyError("Current-source host bootstrap CLI proof required.")
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = json.loads(private_file(infra.JOURNAL))
        cp = json.loads(private_file(control.JOURNAL))
        if journal.get("stop") or not journal.get("encryptionRepair", {}).get("complete"):
            raise KeySafetyError("Encrypted instance+attachment must PASS and no failure hold may remain before host operations.")
        client = ReadOnlyOci(ensure_session())
        client.compartments.add(cp["created"]["compartment"]["id"])
        state = host_ssh.enroll(journal, cp, client)
        if sys.argv[1:] == ["inspect"]:
            result = host_ssh.run_remote(Path(__file__).with_name("guest_volume.py").read_text(), ["inspect"])
            journal["guestDiskInspection"] = result
        elif sys.argv[1:] == ["diagnose-format"]:
            entry = journal["dataMountIntent"]
            result = host_ssh.run_remote(Path(guest_volume.__file__).read_text(), ["diagnose-recorded", entry["uuid"], entry["device"]])
            entry["readbackDiagnostic"] = result
        else:
            mount_and_reboot(journal)
            result = journal["dataMountIntent"]["rebootVerified"]
        journal["sshHostFingerprint"] = state["fingerprint"]
        journal["sshConsoleHistoryId"] = state["consoleHistoryId"]
        atomic_metadata(infra.JOURNAL, journal)
        print(json.dumps(result))
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: host inspection failed; raw output suppressed, no retry.", file=sys.stderr)
        raise SystemExit(1)
