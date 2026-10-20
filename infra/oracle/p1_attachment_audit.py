#!/usr/bin/env python3
"""Read-only reconciliation after the recorded attachment400; never retry it."""
import fcntl
import json
import os
import sys

from bootstrap_audit import KEY_DIRECTORY
from key_ceremony import KeySafetyError
import p1_infrastructure as infra
from security_session import atomic_metadata, private_file


def main():
    if len(sys.argv) != 1:
        raise KeySafetyError("Fixed read-only attachment audit only.")
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = json.loads(private_file(infra.JOURNAL))
        pending = journal.get("pending")
        if not pending or pending.get("kind") != "attachment" or pending.get("id"):
            raise KeySafetyError("Expected the unresolved attachment intent without a response ID; no reset.")
        instance = infra.invoke(infra.cli_arguments("instance", "get", resource_id=infra.identifier(journal, "instance")))
        volume = infra.invoke(infra.cli_arguments("volume", "get", resource_id=infra.identifier(journal, "volume")))
        infra.verify("instance", journal["created"]["instance"], instance)
        infra.verify("volume", journal["created"]["volume"], volume)
        attachments = infra.invoke(["compute", "volume-attachment", "list", "--compartment-id", instance["compartment-id"], "--instance-id", instance["id"], "--all"])
        if not isinstance(attachments, list):
            raise KeySafetyError("Incomplete attachment reconciliation; no create.")
        matching = [row for row in attachments if row.get("volume-id") == volume["id"] and row.get("lifecycle-state") != "DETACHED"]
        if matching:
            raise KeySafetyError("Unexpected attachment found; preserve intent and reconcile, never retry.")
        diagnostic = {"matchingAttachmentCount": len(matching), "instanceState": instance["lifecycle-state"],
                      "volumeState": volume["lifecycle-state"], "volumeGB": volume["size-in-gbs"],
                      "instancePvEncryptionEnabled": instance.get("launch-options", {}).get("is-pv-encryption-in-transit-enabled"),
                      "requestedAttachmentEncryption": pending["spec"].get("isPvEncryptionInTransitEnabled"),
                      "cloudWrites": 0, "createRetried": False}
        # This exact status/code came from the one failed create, not from a
        # repeated request. No raw provider message/signature/token is retained.
        pending["failure"] = {"code": "InvalidParameter", "status": 400, "operation": "attach-paravirtualized-volume"}
        journal["stop"] = {"kind": "attachment", **pending["failure"], "realFailure": True}
        journal["attachmentDiagnostic"] = diagnostic
        atomic_metadata(infra.JOURNAL, journal)
        print(json.dumps(diagnostic))
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: read-only reconciliation failed; raw response suppressed; no retry.", file=sys.stderr)
        raise SystemExit(1)
