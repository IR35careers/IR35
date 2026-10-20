#!/usr/bin/env python3
"""Export allowlisted journal metadata only, never specs, IP sources or secrets."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

from bootstrap_audit import ocid
from key_ceremony import KeySafetyError
import p1_control_plane as control
import p1_infrastructure as infra
import p1_finish as finish
from security_session import private_file


def public_report(control_journal, infrastructure):
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
    return {"checkedAt": datetime.now(timezone.utc).isoformat(), "phase": "P1", "phaseComplete": False,
            "resources": resources, "pendingKind": pending.get("kind") if pending else None,
            "capacityAttempts": len(infrastructure.get("capacity", {}).get("attempts", [])),
            "publicIP": infrastructure.get("computeReadback", {}).get("publicIP"),
            "bootVolumeId": infrastructure.get("computeReadback", {}).get("bootVolumeId"),
            "security": infrastructure.get("computeReadback", {}).get("network"),
            "blocker": {key: infrastructure["stop"][key] for key in ("kind", "code", "status", "operation", "realFailure")}
                       if infrastructure.get("stop") else None,
            "attachmentDiagnostic": {key: infrastructure["attachmentDiagnostic"][key] for key in
                                     ("matchingAttachmentCount", "instanceState", "volumeState", "volumeGB", "instancePvEncryptionEnabled", "requestedAttachmentEncryption", "cloudWrites", "createRetried")}
                                    if infrastructure.get("attachmentDiagnostic") else None,
            "productionChanges": 0, "realTimeZeroBillProven": False,
            "note": "Journal readback evidence, not new cloud calls or a full P1/health signoff. Private specs and SSH source addresses omitted."}


def main():
    if len(sys.argv) != 1:
        raise KeySafetyError("Fixed metadata export only.")
    control_journal = json.loads(private_file(control.JOURNAL))
    infrastructure = json.loads(private_file(infra.JOURNAL)) if infra.JOURNAL.exists() else {}
    report = public_report(control_journal, infrastructure)
    target = Path(__file__).resolve().parents[2] / "docs/evidence/oracle-p1-visibility-resources.json"
    target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("PASS: allowlisted P1 evidence exported; verified resource count=" + str(len(report["resources"])))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("STOP: metadata export invalid; raw journal suppressed.", file=sys.stderr)
        raise SystemExit(1)
