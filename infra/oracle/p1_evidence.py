#!/usr/bin/env python3
"""Export allowlisted journal metadata only, never specs, IP sources or secrets."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys

from bootstrap_audit import ocid
from key_ceremony import KeySafetyError
import p1_control_plane as control
import p1_infrastructure as infra
import p1_finish as finish
from security_session import private_file


def public_report(control_journal, infrastructure, identity=None):
    identity = identity or {}
    resources = []
    for source, journal in (("control", control_journal), ("infrastructure", infrastructure)):
        for kind, entry in journal.get("created", {}).items():
            ocid_kind = kind if source == "control" else (infra.KINDS[kind][2] if kind in infra.KINDS else finish.KINDS[kind])
            row = {"kind": kind, "id": ocid(entry["id"], ocid_kind), "verifiedAt": entry["verifiedAt"],
                   "readback": "PASS", "visibility": []}
            for field in ("visibility", "effectiveVisibility"):
                for event in entry.get(field, []):
                    row["visibility"].append({key: event[key] for key in ("resource", "attempt", "elapsedSeconds", "result", "code", "status", "nextDelaySeconds") if key in event})
            if kind == "quota":
                row["effectiveLimits"] = entry.get("effectiveReadback", {}).get("limits")
            resources.append(row)
    pending = infrastructure.get("pending") or control_journal.get("pending")
    trust = infrastructure.get("sshHostTrust", {})
    fingerprint = trust.get("fingerprint")
    if fingerprint is not None and not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", fingerprint):
        raise KeySafetyError("Invalid public fingerprint metadata; no export.")
    mount = infrastructure.get("dataMountIntent", {})
    reboot = mount.get("rebootVerified", {})
    boot_changed = bool(mount.get("prepared", {}).get("bootId") and reboot.get("bootId")
                        and mount["prepared"]["bootId"] != reboot["bootId"])
    cleanup = {"consoleCaptureDeleted": identity.get("console", {}).get("deleted") is True,
               "temporaryPolicyDeleted": identity.get("temporaryIam", {}).get("policy", {}).get("deleted") is True,
               "temporaryGroupDeleted": identity.get("temporaryIam", {}).get("group", {}).get("deleted") is True,
               "verificationSessionDeleted": identity.get("bastionVerification", {}).get("deleted") is True}
    gateway = identity.get("bastionVerification", {}).get("gatewayTrustMethod")
    if gateway not in (None, "signed-API-public-key", "first-use-gateway-public-scan-only;not-out-of-band-verified"):
        raise KeySafetyError("Unexpected gateway trust metadata; no export.")
    subscription = infrastructure.get("created", {}).get("subscription", {}).get("subscriptionState")
    mount_verified = (reboot.get("mounted") is True and reboot.get("uuid") == mount.get("uuid")
                      and bool(mount.get("uuid")) and reboot.get("filesystem") == "ext4"
                      and reboot.get("mountpoint") == "/opt/ir35/data")
    complete = (infrastructure.get("resourceProvisioningComplete") is True and infrastructure.get("guestMountComplete") is True
                and trust.get("status") == "PASS" and bool(fingerprint) and boot_changed and mount_verified and all(cleanup.values())
                and subscription == "ACTIVE" and not infrastructure.get("stop") and not pending)
    return {"checkedAt": datetime.now(timezone.utc).isoformat(), "phase": "P1", "phaseComplete": complete,
            "resources": resources, "pendingKind": pending.get("kind") if pending else None,
            "capacityAttempts": len(infrastructure.get("capacity", {}).get("attempts", [])),
            "publicIP": infrastructure.get("computeReadback", {}).get("publicIP"),
            "bootVolumeId": infrastructure.get("computeReadback", {}).get("bootVolumeId"),
            "security": infrastructure.get("finalNetworkReadback") or infrastructure.get("computeReadback", {}).get("network"),
            "storageBudget": {key: infrastructure.get("finalStorageReadback", {}).get(key) for key in
                              ("storageEnvelope", "proposedLiveVolumeGB", "proposedVolumeBackups", "proposedObjectBytes", "ownerObjectByteCap", "tier")},
            "ownerReopenedRepair": {key: infrastructure.get("bucketReadbackOwnerReopen", {}).get(key) for key in ("attempts", "failures")},
            "blocker": {key: infrastructure["stop"].get(key) for key in ("kind", "code", "status", "operation", "realFailure")}
                       if infrastructure.get("stop") else None,
            "encryptionRepair": {key: infrastructure.get("encryptionRepair", {}).get(key) for key in
                                 ("instanceEncryptionEnabled", "attachmentEncryptionEnabled", "complete")},
            "bootEncryption": {key: infrastructure.get("encryptionRepair", {}).get("bootEncryption", {}).get(key) for key in
                               ("isPvEncryptionInTransitEnabled",)},
            "sshHostTrust": {key: infrastructure.get("sshHostTrust", {}).get(key) for key in
                             ("status", "fingerprint", "viaBastion")},
            "gatewayTrustMethod": gateway,
            "diagnosticCleanup": cleanup,
            "guestMount": {**{key: reboot.get(key) for key in ("mounted", "uuid", "device", "filesystem", "mountpoint", "df")},
                           "bootIdChanged": boot_changed, "reusedRecordedFilesystem": mount.get("prepared", {}).get("formatPerformed") is False},
            "resourceProvisioningComplete": infrastructure.get("resourceProvisioningComplete") is True,
            "notificationSubscriptionState": subscription,
            "ownerAction": "Confirm Oracle Notifications email subscription" if subscription == "PENDING" else None,
            "attachmentDiagnostic": {key: infrastructure["attachmentDiagnostic"][key] for key in
                                     ("matchingAttachmentCount", "instanceState", "volumeState", "volumeGB", "instancePvEncryptionEnabled", "requestedAttachmentEncryption", "cloudWrites", "createRetried")}
                                    if infrastructure.get("attachmentDiagnostic") else None,
            "productionChanges": 0, "realTimeZeroBillProven": False,
            "note": "Journal readback evidence, not new cloud calls or a full P1/health signoff. Private specs, console content and SSH source addresses omitted. attachmentDiagnostic is the historical pre-repair observation."}


def main():
    if len(sys.argv) != 1:
        raise KeySafetyError("Fixed metadata export only.")
    control_journal = json.loads(private_file(control.JOURNAL))
    infrastructure = json.loads(private_file(infra.JOURNAL)) if infra.JOURNAL.exists() else {}
    from host_identity_repair import STATE
    identity = json.loads(private_file(STATE)) if STATE.exists() else {}
    report = public_report(control_journal, infrastructure, identity)
    target = Path(__file__).resolve().parents[2] / "docs/evidence/oracle-p1-visibility-resources.json"
    target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("PASS: allowlisted P1 evidence exported; verified resource count=" + str(len(report["resources"])))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("STOP: metadata export invalid; raw journal suppressed.", file=sys.stderr)
        raise SystemExit(1)
