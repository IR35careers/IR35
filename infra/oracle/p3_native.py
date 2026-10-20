#!/usr/bin/env python3
"""P3 first compatibility gate only; no source connection, secrets or DNS."""
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys

from bootstrap_audit import KEY_DIRECTORY
import host_ssh
from key_ceremony import KeySafetyError
import p1_infrastructure as infra
from p1_compute import verify_network
from p2_harden import STATE as P2, next_attempt
import postgres_probe_guest as guest
from security_session import atomic_metadata, private_file

STATE = KEY_DIRECTORY / "p3-native.json"
REPO = Path(__file__).resolve().parents[2]


def main():
    if sys.argv[1:] not in (["pull"], ["probe"], ["diagnose"]):
        raise KeySafetyError("Fixed P3 native compatibility gate only")
    stage = sys.argv[1]
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = json.loads(private_file(infra.JOURNAL))
        p2 = json.loads(private_file(P2))
        if p2.get("instanceId") != journal["created"]["instance"]["id"] or any(p2.get("stages", {}).get(step, {}).get("status") != "PASS" for step in ("verify", "verify-user", "verify-exposure")):
            raise KeySafetyError("P2 effective host, nonroot SSH and external ports must PASS first")
        network = verify_network(journal)
        pin = json.loads((REPO / "infra/oracle/postgres-image.json").read_text())
        config = guest.validate({"uuid": journal["dataMountIntent"]["uuid"], "image": pin["pinnedImage"], "extensions": pin["requiredExtensions"]})
        state = json.loads(private_file(STATE)) if STATE.exists() else {"phase": "P3", "instanceId": p2["instanceId"], "image": pin["pinnedImage"]}
        if state.get("instanceId") != p2["instanceId"] or state.get("image") != config["image"]:
            raise KeySafetyError("P3 target/image changed; no silent replacement")
        if stage == "probe" and state.get("stages", {}).get("pull", {}).get("status") != "PASS":
            raise KeySafetyError("Native digest-pinned image pull must PASS before probe")
        source = Path(guest.__file__).read_text()
        entry = next_attempt(state, stage, hashlib.sha256(source.encode()).hexdigest())
        atomic_metadata(STATE, state)
        print("P3 CHECK: existing Always Free A1 only; native ARM image, disposable empty DB, network none, no ports, 3GiB memory limit; no OCI create/source data/secrets/DNS/production.", flush=True)
        try:
            result = host_ssh.run_remote(source, [stage, json.dumps(config, separators=(",", ":"))], timeout=1500 if stage == "pull" else 240)
            entry.update(status=result.get("status", "FAIL"), result=result, checkedAt=datetime.now(timezone.utc).isoformat())
        except Exception:
            entry["status"] = "FAIL"
            atomic_metadata(STATE, state)
            raise
        atomic_metadata(STATE, state)
        report = {"phase": "P3", "phaseComplete": False, "checkedAt": entry["checkedAt"], "image": state["image"],
            "nativeImage": state["stages"]["pull"].get("result"), "extensionProbe": result if stage == "probe" else None,
            "remainingGates": ["Official slim Compose review/pins and fresh target migrations/schema diff", "Protected staging DNS and Caddy runtime-secret custody", "Private Auth configuration export later in P7"],
            "stages": {key: {field: value[field] for field in ("status", "attempts", "sourceSHA256")} for key, value in state["stages"].items()},
            "productionChanges": 0, "cloudDataReads": 0, "network": network}
        (REPO / "docs/evidence/oracle-p3-native.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(result), flush=True)
        if result.get("status") != "PASS" and stage != "diagnose":
            raise KeySafetyError("Native image extension compatibility FAIL; stop before staging setup/restore")
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: P3 probe helper failed; raw output suppressed and durable attempt retained", file=sys.stderr)
        raise SystemExit(1)
