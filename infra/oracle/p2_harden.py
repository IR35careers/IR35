#!/usr/bin/env python3
"""Owner-approved P2 only; pinned SSH, no cloud creates or application deploy."""
from datetime import datetime, timezone
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import socket
import sys

from bootstrap_audit import KEY_DIRECTORY
import hardening_guest
import host_ssh
from host_identity_repair import STATE as IDENTITY
from key_ceremony import KeySafetyError
import p1_control_plane as control
import p1_infrastructure as infra
from p1_compute import verify_network
from p1_evidence import public_report
from security_session import atomic_metadata, private_file

STATE = KEY_DIRECTORY / "p2-hardening.json"
PRIVATE_PORTS = (111, 2375, 2376, 3000, 5432, 8000, 8001, 8025, 8080, 8443, 9090, 1025)


def external_exposure(address):
    host = str(ipaddress.IPv4Address(address))
    if not ipaddress.ip_address(host).is_global:
        raise KeySafetyError("Public staging IPv4 required for external port verification")
    # A positive SSH control distinguishes closed private ports from a broken
    # path to the VM. No HTTP request, credential, or application is submitted.
    with socket.create_connection((host, 22), timeout=5):
        pass
    closed = []
    for port in PRIVATE_PORTS:
        try:
            with socket.create_connection((host, port), timeout=3):
                pass
        except (ConnectionRefusedError, TimeoutError):
            closed.append(port)
        else:
            raise KeySafetyError("Unexpected externally reachable staging TCP port: " + str(port))
    return {"status": "PASS", "sshPositiveControl": True, "privateTCPPortsUnreachable": closed}
USER_CHECK = """import json,os,subprocess
r=subprocess.run(['sudo','-n','true'],capture_output=True)
groups=subprocess.run(['id','-nG'],capture_output=True,text=True,check=True).stdout.split()
print(json.dumps({'status':'PASS' if os.geteuid()!=0 and r.returncode!=0 and groups==['ir35'] and not os.access('/var/run/docker.sock',os.W_OK) else 'FAIL',
 'uid':os.geteuid(),'groups':groups,'sudoAvailable':r.returncode==0,'dockerSocketWritable':os.access('/var/run/docker.sock',os.W_OK)}))
"""


def next_attempt(state, stage, source_hash):
    entry = state.setdefault("stages", {}).setdefault(stage, {"attempts": 0})
    if entry["attempts"] >= 3:
        raise KeySafetyError("P2 stage failed three times; owner gate, no further execution: " + stage)
    entry.update(attempts=entry["attempts"] + 1, sourceSHA256=source_hash, status="RUNNING")
    return entry


def main():
    if sys.argv[1:] not in (["audit"], ["install"], ["configure"], ["verify"], ["verify-user"], ["verify-exposure"], ["repair-firewall-order"], ["diagnose-firewall"], ["diagnose-controls"], ["disable-unused-rpc"]):
        raise KeySafetyError("Fixed P2 install/configure/verify only")
    stage = sys.argv[1]
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = json.loads(private_file(infra.JOURNAL))
        cp = json.loads(private_file(control.JOURNAL))
        identity = json.loads(private_file(IDENTITY))
        if public_report(cp, journal, identity)["phaseComplete"] is not True:
            raise KeySafetyError("P1 must PASS before host hardening")
        state = json.loads(private_file(STATE)) if STATE.exists() else {"phase": "P2", "instanceId": journal["created"]["instance"]["id"]}
        if state["instanceId"] != journal["created"]["instance"]["id"]:
            raise KeySafetyError("P2 target identity mismatch")
        for previous in {"audit": [], "install": ["audit"], "configure": ["install"], "verify": ["install", "configure"],
                         "verify-user": ["verify"], "verify-exposure": ["verify-user"], "repair-firewall-order": ["configure"], "diagnose-firewall": ["configure"],
                         "diagnose-controls": ["configure"], "disable-unused-rpc": ["configure"]}[stage]:
            if state.get("stages", {}).get(previous, {}).get("status") != "PASS":
                raise KeySafetyError("P2 prerequisite stage not PASS: " + previous)
        network = verify_network(journal)
        config = hardening_guest.public_config({"uuid": journal["dataMountIntent"]["uuid"],
            "ownerCIDR": journal["ownerCIDR"], "bastionCIDR": journal["bastionCIDR"],
            "publicKey": private_file(KEY_DIRECTORY / "ssh_ed25519.pub").strip()})
        source = USER_CHECK if stage == "verify-user" else Path(__file__ if stage == "verify-exposure" else hardening_guest.__file__).read_text()
        entry = next_attempt(state, stage, hashlib.sha256(source.encode()).hexdigest())
        atomic_metadata(STATE, state)
        try:
            result = external_exposure(journal["computeReadback"]["publicIP"]) if stage == "verify-exposure" else host_ssh.run_remote(source, [] if stage == "verify-user" else [stage, json.dumps(config, separators=(",", ":"))],
                                        timeout=1800 if stage == "install" else 600, user="ir35" if stage == "verify-user" else "ubuntu")
            if stage in ("verify", "verify-user") and result.get("status") != "PASS":
                raise KeySafetyError("Host verification result not PASS")
        except Exception:
            entry["status"] = "FAIL"
            atomic_metadata(STATE, state)
            raise
        entry.update(status="PASS", verifiedAt=datetime.now(timezone.utc).isoformat(), result=result)
        state["network"] = network
        atomic_metadata(STATE, state)
        if stage in ("verify", "verify-user", "verify-exposure"):
            if result.get("status") != "PASS":
                raise KeySafetyError("Guest hardening verification not PASS")
            report = {"phase": "P2", "checkedAt": entry["verifiedAt"], "instanceId": state["instanceId"],
                "host": state["stages"]["verify"]["result"], "network": network, "phaseComplete": stage == "verify-exposure",
                "deployUserLogin": state["stages"].get("verify-user", {}).get("result"),
                "externalExposure": result if stage == "verify-exposure" else None,
                "remainingCheck": None if stage == "verify-exposure" else "Fresh ir35 login and external private-port negative probes",
                "stages": {key: {field: value[field] for field in ("status", "attempts", "sourceSHA256")} for key, value in state["stages"].items()}}
            path = Path(__file__).resolve().parents[2] / "docs/evidence/oracle-p2-hardening.json"
            path.write_text(json.dumps(report, indent=2) + "\n")
        print("PASS: P2 " + stage + "; " + json.dumps(result), flush=True)
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: P2 helper failed; raw output suppressed, durable attempt retained", file=sys.stderr)
        raise SystemExit(1)
