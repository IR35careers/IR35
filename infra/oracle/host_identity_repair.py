#!/usr/bin/env python3
"""Owner-authorised console-first host identity repair. Raw console stays in RAM."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from bootstrap_audit import KEY_DIRECTORY, ocid
from key_ceremony import KeySafetyError, write_new
import p1_control_plane as control
import p1_infrastructure as infra
from resource_audit import ReadOnlyOci
from security_session import atomic_metadata, clean_environment, command, ensure_session, private_file
from visibility import OciError, call_timeout, wait_for_visible

STATE = KEY_DIRECTORY / "p1-host-identity-repair.json"
NAME = "ir35-ssh-hostkey-owner-recapture"


def console_fingerprint(text):
    """Only the explicit host-key block is trusted, never arbitrary boot hashes."""
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text).replace("\r", "")
    begin, end = "BEGIN SSH HOST KEY FINGERPRINTS", "END SSH HOST KEY FINGERPRINTS"
    if begin not in text and end not in text:
        return None
    blocks = re.findall(re.escape(begin) + r"(.*?)" + re.escape(end), text, re.S)
    if not blocks or len(blocks) != text.count(begin) or len(blocks) != text.count(end):
        raise KeySafetyError("Incomplete console fingerprint block; no IAM fallback or SSH pin.")
    for algorithm in ("ED25519", "ECDSA"):
        fingerprints = set()
        for block in blocks:
            for line in block.splitlines():
                match = re.fullmatch(r"\s*\d+\s+(SHA256:[A-Za-z0-9+/]{43})\s+[^\n]*\(" + algorithm + r"\)\s*", line)
                if match:
                    fingerprints.add(match[1])
        if len(fingerprints) > 1:
            raise KeySafetyError("Conflicting host fingerprints in console; stop, no fallback.")
        if fingerprints:
            return {"algorithm": algorithm.lower(), "fingerprint": fingerprints.pop()}
    raise KeySafetyError("Fingerprint block has no supported SHA256 host key; no IAM fallback.")


def console_identity(row, state, tags):
    if (row.get("instance-id") != state["instanceId"] or row.get("display-name") != NAME
            or row.get("freeform-tags") != tags):
        raise KeySafetyError("Console capture ownership mismatch; no read or deletion.")
    return ocid(row.get("id"), "consolehistory")


def console_cleanup(state, tags):
    entry = state["console"]
    identifier = entry["id"]
    get = ["compute", "console-history", "get", "--instance-console-history-id", identifier]
    try:
        row = infra.invoke(get)
    except OciError as error:
        if error.status == 404 and entry.get("deleteRequested"):
            entry["deleted"] = True
            atomic_metadata(STATE, state)
            return
        raise
    if console_identity(row, state, tags) != identifier:
        raise KeySafetyError("Different console ID; no delete.")
    if not entry.get("deleteRequested"):
        entry["deleteRequested"] = True
        atomic_metadata(STATE, state)
        ensure_session()
        result = subprocess.run(command(["compute", "console-history", "delete", "--instance-console-history-id", identifier, "--force"]),
                                capture_output=True, text=True, timeout=call_timeout(), env=clean_environment(), check=False)
        if result.returncode:
            raise OciError.from_stderr("owned-console-delete", result.stderr)
    def gone():
        try:
            console_identity(infra.invoke(get), state, tags)
        except OciError as error:
            if error.status == 404:
                return True
            raise
        return None
    wait_for_visible(gone, label="owned-console-deletion", record=lambda event: None)
    entry["deleted"] = True
    atomic_metadata(STATE, state)
    print("PASS: owner-requested console capture deleted and absence independently verified; raw console never saved.", flush=True)


def console_first(state, journal, cp, client):
    tags = {"ir35-phase": "P1", "ir35-intent": journal["intent"], "ir35-purpose": "owner-console-first"}
    entry = state.setdefault("console", {})
    if entry.get("readComplete"):
        if not entry.get("deleted"):
            console_cleanup(state, tags)
        return entry.get("publicFingerprint")
    listed = infra.invoke(["compute", "console-history", "list", "--compartment-id", cp["created"]["compartment"]["id"],
                           "--instance-id", state["instanceId"], "--all"])
    found = [row for row in listed if row.get("display-name") == NAME]
    if len(found) > 1:
        raise KeySafetyError("Duplicate owner console capture name; no create.")
    if found:
        entry["id"] = console_identity(found[0], state, tags)
    elif not entry.get("createRequested"):
        entry["eligibility"] = infra.fresh_eligibility(client, journal, journal["created"]["instance"]["spec"]["availabilityDomain"])
        entry["createRequested"] = True
        atomic_metadata(STATE, state)
        print("CREATE CHECK: diagnostic snapshot of same Always Free A1 2/12, live150GB; no added compute/storage/service or production. Owner requested one new capture.", flush=True)
        row = infra.invoke(["compute", "console-history", "capture", "--instance-id", state["instanceId"],
                            "--display-name", NAME, "--freeform-tags", json.dumps(tags)])
        entry["id"] = console_identity(row, state, tags)
        atomic_metadata(STATE, state)
    if not entry.get("id"):
        raise KeySafetyError("Ambiguous console capture outcome; never submit a second capture.")
    def ready():
        row = infra.invoke(["compute", "console-history", "get", "--instance-console-history-id", entry["id"]])
        if console_identity(row, state, tags) != entry["id"]:
            raise KeySafetyError("Console capture ID changed.")
        if row.get("lifecycle-state") in ("REQUESTED", "GETTING-HISTORY"):
            return None
        if row.get("lifecycle-state") != "SUCCEEDED":
            raise KeySafetyError("Console capture failed; no IAM fallback.")
        return True
    def record(event):
        entry.setdefault("visibility", []).append(event)
        atomic_metadata(STATE, state)
    wait_for_visible(ready, label="owner-console-capture", record=record)
    ensure_session()
    raw = subprocess.run(command(["compute", "console-history", "get-content", "--instance-console-history-id", entry["id"],
                                  "--length", "10000000", "--offset", "0", "--file", "-"]),
                         capture_output=True, text=True, timeout=65, env=clean_environment(), check=False)
    if raw.returncode:
        raise OciError.from_stderr("owner-console-content", raw.stderr)
    if len(raw.stdout.encode()) > 10_000_000:
        raise KeySafetyError("Console response exceeds requested bound; suppressed.")
    fingerprint = console_fingerprint(raw.stdout)
    # Keep no log content, names, other hashes, response headers or raw blocks.
    entry.update(readComplete=True, fingerprintBlockPresent=fingerprint is not None, publicFingerprint=fingerprint)
    atomic_metadata(STATE, state)
    console_cleanup(state, tags)
    print(json.dumps({"consoleFingerprintBlockPresent": fingerprint is not None, "publicFingerprint": fingerprint,
                      "temporaryIamFallbackApproved": fingerprint is None, "consoleDeleted": True}), flush=True)
    return fingerprint


def main():
    if sys.argv[1:] not in (["console-first"], ["temporary-fallback"], ["bastion-verify"], ["bastion-reconcile"]):
        raise KeySafetyError("Fixed owner console-first or conditional temporary-fallback checkpoint only.")
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal, cp = json.loads(private_file(infra.JOURNAL)), json.loads(private_file(control.JOURNAL))
        if journal.get("stop", {}).get("code") != "ConsoleFingerprintMissing" or not journal.get("encryptionRepair", {}).get("complete"):
            raise KeySafetyError("Only the owner-reopened host fingerprint hold may use this repair.")
        identifier = infra.identifier(journal, "instance")
        if not STATE.exists():
            write_new(STATE, json.dumps({"instanceId": identifier, "ownerOrder": "20261020-console-first-conditional-iam"}).encode())
        state = json.loads(private_file(STATE))
        if state.get("instanceId") != identifier or state.get("halted") and sys.argv[1:] != ["bastion-reconcile"]:
            raise KeySafetyError("Host repair identity/failure hold; no automatic repeat.")
        client = ReadOnlyOci(ensure_session())
        client.compartments.add(cp["created"]["compartment"]["id"])
        try:
            if sys.argv[1:] == ["console-first"]:
                console_first(state, journal, cp, client)
            elif sys.argv[1:] == ["temporary-fallback"]:
                from host_identity_iam import temporary_fallback
                fingerprint = temporary_fallback(state, journal, cp, client)
                print(json.dumps({"publicFingerprint": fingerprint, "temporaryPolicyDeleted": True,
                                  "temporaryGroupDeleted": True, "sshEnrolled": False}), flush=True)
            elif sys.argv[1:] == ["bastion-verify"]:
                from host_identity_bastion import verify_and_pin
                verify_and_pin(state, journal, cp, client)
            else:
                from host_identity_bastion import reconcile_public_key_newline
                reconcile_public_key_newline(state, journal, cp, client)
        except KeySafetyError as error:
            state["halted"] = {"code": getattr(error, "code", "HostRepairCheckFailed"), "status": getattr(error, "status", None)}
            atomic_metadata(STATE, state)
            raise
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: console-first repair failed; pending intent retained, raw output suppressed.", file=sys.stderr)
        raise SystemExit(1)
