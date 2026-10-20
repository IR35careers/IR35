#!/usr/bin/env python3
"""Pin VM SSH host identity, then inspect before any filesystem mutation."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import sys
import time

from key_ceremony import KeySafetyError
from bootstrap_audit import KEY_DIRECTORY
import host_ssh
import p1_control_plane as control
import p1_infrastructure as infra
from resource_audit import ReadOnlyOci
from security_session import atomic_metadata, ensure_session, private_file


def main():
    if sys.argv[1:] != ["inspect"]:
        raise KeySafetyError("Fixed disk inspect checkpoint only.")
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
        result = host_ssh.run_remote(Path(__file__).with_name("guest_volume.py").read_text(), ["inspect"])
        journal["guestDiskInspection"] = result
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
