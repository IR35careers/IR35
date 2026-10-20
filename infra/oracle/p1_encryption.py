#!/usr/bin/env python3
"""Owner-specific in-place encryption prerequisite repair; no VM recreation."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import time

from bootstrap_audit import KEY_DIRECTORY, ocid
from key_ceremony import KeySafetyError
import p1_control_plane as control
import p1_infrastructure as infra
import p1_finish as finish
from resource_audit import ReadOnlyOci
from security_session import atomic_metadata, ensure_session, private_file
from visibility import OciError, wait_for_visible


def platform_pv(instance, image):
    if (instance.get("shape") != infra.SHAPE or image.get("id") != instance.get("image-id")
            or "compartment-id" not in image or image["compartment-id"] is not None
            or image.get("listing-type") not in (None, "NONE") or image.get("operating-system") != "Canonical Ubuntu"
            or image.get("operating-system-version") != "24.04" or "aarch64" not in image.get("display-name", "")):
        raise KeySafetyError("STOP: VM must use the original Oracle Ubuntu24.04 ARM platform image, not a custom image.")
    options = instance.get("launch-options", {})
    if options.get("remote-data-volume-type") != "PARAVIRTUALIZED" or options.get("boot-volume-type") != "PARAVIRTUALIZED":
        raise KeySafetyError("STOP: boot/data launch attachment types must be PARAVIRTUALIZED, never iSCSI.")
    return True


def update_arguments(instance_id):
    return ["compute", "instance", "update", "--instance-id", ocid(instance_id, "instance"),
            "--launch-options", '{"isPvEncryptionInTransitEnabled":true}', "--force"]


def boot_encryption_report(row, instance_id, boot_id):
    # OCI returned the instance OCID as this boot attachment's id. Do not
    # invent a bootvolumeattachment OCID type. Bind the actual parent pair.
    if row.get("instance-id") != instance_id or row.get("boot-volume-id") != boot_id or row.get("lifecycle-state") != "ATTACHED":
        raise KeySafetyError("Boot attachment parent/volume/state mismatch; no VM recreation.")
    return {"isPvEncryptionInTransitEnabled": row.get("is-pv-encryption-in-transit-enabled"),
            "isEncryptionInTransitEnabled": row.get("is-encryption-in-transit-enabled"), "source": "authenticated complete boot-attachment list"}


def repair(journal, cp, client):
    stop = journal.get("stop")
    if stop and not (stop.get("kind") == "attachment" and stop.get("status") == 400) and not (
            stop.get("kind") == "attachment-encryption-repair"
            and stop.get("message") == "Invalid local public OCI identifier; no request made."):
        raise KeySafetyError("A different real failure is present; no continuation or cloud call.")
    child = cp["created"]["compartment"]["id"]
    instance_id = infra.identifier(journal, "instance")
    entry = journal.setdefault("encryptionRepair", {"ownerOrder": "20261020-instance-encryption", "updateRequested": False})
    local_id_repair = entry.get("halted") == {"code": "RepairCheckFailed", "status": None, "message": "Invalid local public OCI identifier; no request made."}
    if entry.get("halted") and not local_id_repair:
        raise KeySafetyError("Encryption repair has a real failure recorded; no automatic repeat.")
    observed = infra.invoke(infra.cli_arguments("instance", "get", resource_id=instance_id))
    infra.verify("instance", journal["created"]["instance"], observed)
    image = infra.invoke(["compute", "image", "get", "--image-id", ocid(observed.get("image-id"), "image")])
    platform_pv(observed, image)
    payload = finish.spec("attachment", journal, child, "unused")
    found = finish.matches("attachment", payload, child)
    if found and found[0].get("attachment-type", "").lower() != "paravirtualized":
        raise KeySafetyError("Existing data attachment is not paravirtualized; no detach/recreate.")
    entry["platformImageVerified"] = True
    entry["dataAttachmentType"] = "PARAVIRTUALIZED"
    atomic_metadata(infra.JOURNAL, journal)
    if observed["launch-options"].get("is-pv-encryption-in-transit-enabled") is not True:
        if entry["updateRequested"]:
            raise KeySafetyError("Pending instance update must reconcile; no second update request.")
        entry["eligibility"] = infra.fresh_eligibility(client, journal, observed["availability-domain"])
        entry["updateRequested"] = True
        atomic_metadata(infra.JOURNAL, journal)
        print("UPDATE CHECK: same Always Free A1 2/12, same50+100GB; enable instance in-transit encryption only, owner-approved reboot. No production.", flush=True)
        infra.invoke(update_arguments(instance_id))
    def running():
        current = infra.invoke(infra.cli_arguments("instance", "get", resource_id=instance_id))
        platform_pv(current, image)
        if current.get("id") != instance_id:
            raise KeySafetyError("Instance identity changed during encryption wait.")
        state = current.get("lifecycle-state")
        if state in ("STOPPING", "STOPPED", "STARTING", "UPDATING", "PROVISIONING"):
            return None
        if state != "RUNNING":
            raise KeySafetyError("Unexpected instance lifecycle during encryption update.")
        if current.get("launch-options", {}).get("is-pv-encryption-in-transit-enabled") is not True:
            return None
        infra.verify("instance", journal["created"]["instance"], current)
        return current
    observed = wait_for_visible(running, label="instance-encryption", record=infra.recorder(journal, entry))
    journal["created"]["instance"]["spec"]["launchOptions"] = {"isPvEncryptionInTransitEnabled": True}
    entry["instanceEncryptionEnabled"] = True
    boots = finish.rows(infra.invoke(["compute", "boot-volume-attachment", "list", "--compartment-id", child,
                                     "--availability-domain", observed["availability-domain"], "--instance-id", instance_id, "--all"]))
    boots = [row for row in boots if row.get("lifecycle-state") == "ATTACHED"]
    if len(boots) != 1:
        raise KeySafetyError("Expected one attached boot volume; no VM recreation.")
    entry["bootEncryption"] = boot_encryption_report(boots[0], instance_id, journal["computeReadback"]["bootVolumeId"])
    if local_id_repair:
        entry["localIdValidationRepair"] = {"priorError": entry.pop("halted"), "parentAndVolumeVerified": True, "updateRepeated": False}
        if journal.get("stop", {}).get("kind") == "attachment-encryption-repair" and journal["stop"].get("message") == "Invalid local public OCI identifier; no request made.":
            entry["localIdValidationRepair"]["priorStop"] = journal.pop("stop")
    atomic_metadata(infra.JOURNAL, journal)
    print("PASS: instance RUNNING/encryptiontrue; boot attachment encryption=" + json.dumps(entry["bootEncryption"]), flush=True)
    finish.check_attachment_prerequisite(observed, image, payload)
    found = finish.matches("attachment", payload, child)
    pending = journal.get("pending")
    if pending:
        if pending.get("kind") != "attachment" or pending.get("spec") != payload:
            raise KeySafetyError("Different pending intent; no reset or attach.")
        if not found and not pending.get("id"):
            failure = pending.get("failure", {})
            if failure.get("code") != "InvalidParameter" or failure.get("status") != 400 or entry.get("attachmentAttemptAuthorised"):
                raise KeySafetyError("Attachment outcome not the owner-reopened definitive400; do not recreate blindly.")
            # Explicit new owner repair plus zero matching resources and a known
            # rejected request permit ONE new request, not an ambiguity retry.
            journal.setdefault("failureHistory", []).append({"stop": journal.get("stop"), "intent": pending, "reconciledAbsent": True})
            entry["attachmentAttemptAuthorised"] = True
            journal["pending"] = None
    if journal.get("stop"):
        stop = journal["stop"]
        if stop.get("kind") != "attachment" or stop.get("status") != 400:
            raise KeySafetyError("A different real failure is present; no continuation.")
        entry["previousStop"] = journal.pop("stop")
    atomic_metadata(infra.JOURNAL, journal)
    finish.create_one("attachment", journal, child, payload,
                      lambda: infra.fresh_eligibility(client, journal, observed["availability-domain"]),
                      prerequisite=lambda: finish.attachment_prerequisite(journal, payload))
    result = infra.invoke(finish.args("attachment", "get", payload, child, journal["created"]["attachment"]["id"]))
    finish.verify("attachment", payload, result)
    if result.get("attachment-type", "").lower() != "paravirtualized":
        raise KeySafetyError("Read-back must be PARAVIRTUALIZED; no filesystem operation.")
    entry["attachmentEncryptionEnabled"] = result.get("is-pv-encryption-in-transit-enabled") is True
    entry["attachmentDevice"] = result.get("device")
    entry["complete"] = True
    atomic_metadata(infra.JOURNAL, journal)
    print("PASS: same100GBvolume ATTACHED/paravirtualized/encryptiontrue; no duplicate attachment.", flush=True)


def main():
    if sys.argv[1:] != ["repair"]:
        raise KeySafetyError("Fixed owner-specific repair only.")
    proof = json.loads(private_file(control.PREFLIGHT_RECEIPT))
    if (proof.get("status") != "PASS" or not 0 <= time.time() - proof["checkedAt"] <= 1800
            or proof.get("encryptionSHA256") != hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
            or proof.get("finishSHA256") != hashlib.sha256(Path(finish.__file__).read_bytes()).hexdigest()):
        raise KeySafetyError("Current-source encryption/attachment CLI proof required.")
    os.umask(0o077)
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = json.loads(private_file(infra.JOURNAL))
        cp = json.loads(private_file(control.JOURNAL))
        client = ReadOnlyOci(ensure_session())
        client.compartments.add(cp["created"]["compartment"]["id"])
        try:
            repair(journal, cp, client)
        except KeySafetyError as error:
            detail = getattr(error, "detail", {"code": getattr(error, "code", "RepairCheckFailed"), "status": getattr(error, "status", None), "message": str(error)})
            journal.setdefault("encryptionRepair", {})["halted"] = detail
            journal["stop"] = {"kind": "attachment-encryption-repair", "realFailure": True, **detail}
            atomic_metadata(infra.JOURNAL, journal)
            raise KeySafetyError("Encryption repair stopped: " + json.dumps(detail)) from None
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: repair operation failed; pending intent retained, raw output suppressed. No retry.", file=sys.stderr)
        raise SystemExit(1)
