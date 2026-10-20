"""Conditional temporary exact-VM public-fingerprint retrieval; no other IAM grants."""
import hashlib
import json
import re
import subprocess
import time

from bootstrap_audit import ocid
from key_ceremony import KeySafetyError
import host_identity_repair as repair
import p1_infrastructure as infra
from security_session import atomic_metadata, clean_environment, command, ensure_session
from visibility import OciError, call_timeout, wait_for_visible

GROUP = "ir35-hostkey-temporary"
POLICY = "ir35-hostkey-execution-temporary"
COMMAND = "ir35-public-host-fingerprint"
SCRIPT = "#!/bin/bash\nset -eu\n/usr/bin/ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256\n"


def specs(instance, child, root, intent):
    instance = ocid(instance, "instance")
    tags = {"ir35-phase": "P1", "ir35-intent": intent, "ir35-purpose": "temporary-hostkey"}
    return {
        "group": {"compartmentId": ocid(root, "tenancy"), "name": GROUP, "description": "Temporary public host fingerprint, one staging VM only",
                  "matchingRule": "ALL {instance.id = '" + instance + "'}", "freeformTags": tags},
        "policy": {"compartmentId": ocid(child, "compartment"), "name": POLICY, "description": "Temporary command execution only for matching staging instance",
                   "statements": ["Allow dynamic-group " + GROUP + " to use instance-agent-command-execution-family in compartment ir35 where request.instance.id=target.instance.id"],
                   "freeformTags": tags}}


def args(kind, operation, payload, identifier=None):
    group = "dynamic-group" if kind == "group" else "policy"
    prefix = ["iam", group, operation]
    if operation == "list":
        return [*prefix, "--compartment-id", payload["compartmentId"], "--all"]
    if operation in ("get", "delete"):
        return [*prefix, "--" + group + "-id", ocid(identifier, "dynamicgroup" if kind == "group" else "policy"), *(["--force"] if operation == "delete" else [])]
    if operation == "create":
        result = prefix[:]
        for key, value in payload.items():
            result += ["--" + re.sub(r"[A-Z]", lambda match: "-" + match[0].lower(), key), value if isinstance(value, str) else json.dumps(value)]
        return result
    raise KeySafetyError("Unsupported temporary IAM operation.")


def verify(kind, payload, row):
    if not infra.contains(infra.canonical(row), infra.canonical(payload)):
        raise KeySafetyError("Temporary IAM name/parent/tags/least-privilege specification differs; no update/delete.")
    return ocid(row.get("id"), "dynamicgroup" if kind == "group" else "policy")


def ensure_one(state, kind, payload, eligibility):
    entry = state.setdefault("temporaryIam", {}).setdefault(kind, {})
    rows = infra.invoke(args(kind, "list", payload))
    found = [row for row in rows if row.get("name") == payload["name"] and row.get("lifecycle-state") != "DELETED"]
    if len(found) > 1:
        raise KeySafetyError("Duplicate temporary IAM name; no create.")
    if found:
        identifier = verify(kind, payload, found[0])
        if entry.get("id") not in (None, identifier):
            raise KeySafetyError("Temporary IAM identity changed; no create.")
        entry["id"] = identifier
    elif not entry.get("createRequested"):
        entry["eligibility"] = eligibility()
        entry["createRequested"] = True
        atomic_metadata(repair.STATE, state)
        print("CREATE CHECK: temporary " + kind + "; IAM/no service charge, exact one2/12stagingVM, live150GB free envelope rechecked. No other IAM or production access.", flush=True)
        entry["id"] = verify(kind, payload, infra.invoke(args(kind, "create", payload)))
        atomic_metadata(repair.STATE, state)
    if not entry.get("id"):
        raise KeySafetyError("Ambiguous temporary IAM create; reconcile, never create twice.")
    def visible():
        row = infra.invoke(args(kind, "get", payload, entry["id"]))
        if row.get("lifecycle-state") == "CREATING":
            return None
        if row.get("lifecycle-state") != "ACTIVE" or verify(kind, payload, row) != entry["id"]:
            raise KeySafetyError("Temporary IAM readback is not exact ACTIVE identity.")
        return True
    wait_for_visible(visible, label="temporary-hostkey-" + kind)
    entry["verified"] = True
    atomic_metadata(repair.STATE, state)


def remove_one(state, kind, payload):
    entry = state.get("temporaryIam", {}).get(kind, {})
    if not entry.get("id"):
        if entry.get("createRequested"):
            raise KeySafetyError("Unknown IAM create result; reconcile before cleanup, never broad-delete.")
        return
    get = args(kind, "get", payload, entry["id"])
    try:
        row = infra.invoke(get)
    except OciError as error:
        if error.status == 404 and entry.get("deleteRequested"):
            entry["deleted"] = True
            atomic_metadata(repair.STATE, state)
            return
        raise
    if verify(kind, payload, row) != entry["id"]:
        raise KeySafetyError("Temporary cleanup identity mismatch.")
    if not entry.get("deleteRequested"):
        entry["deleteRequested"] = True
        atomic_metadata(repair.STATE, state)
        ensure_session()
        result = subprocess.run(command(args(kind, "delete", payload, entry["id"])), capture_output=True, text=True,
                                timeout=call_timeout(), env=clean_environment(), check=False)
        if result.returncode:
            raise OciError.from_stderr("temporary-hostkey-" + kind + "-delete", result.stderr)
    def absent():
        try:
            verify(kind, payload, infra.invoke(get))
        except OciError as error:
            if error.status == 404:
                return True
            raise
        return None
    wait_for_visible(absent, label="temporary-hostkey-" + kind + "-deleted")
    remaining = infra.invoke(args(kind, "list", payload))
    if any(row.get("id") == entry["id"] and row.get("lifecycle-state") != "DELETED" for row in remaining):
        raise KeySafetyError("Temporary IAM remains listed; cleanup not proven.")
    entry["deleted"] = True
    atomic_metadata(repair.STATE, state)
    print("PASS: temporary " + kind + " deleted; independent GET404 and complete LIST absence.", flush=True)


def command_payload(instance, child):
    return {"compartmentId": child, "displayName": COMMAND, "target": {"instanceId": instance}, "executionTimeOutInSeconds": 30,
            "content": {"source": {"sourceType": "TEXT", "text": SCRIPT, "textSha256": hashlib.sha256(SCRIPT.encode()).hexdigest()}, "output": {"outputType": "TEXT"}}}


def command_args(payload):
    return ["instance-agent", "command", "create", "--compartment-id", payload["compartmentId"], "--display-name", COMMAND,
            "--target", json.dumps(payload["target"]), "--timeout-in-seconds", "30", "--content", json.dumps(payload["content"])]


def parse_public_output(execution, command_id, instance):
    if execution.get("instance-agent-command-id") != command_id or execution.get("instance-id") != instance:
        raise KeySafetyError("Command execution target/identity mismatch; no SSH pin.")
    if execution.get("lifecycle-state") != "SUCCEEDED":
        raise KeySafetyError("Fingerprint command has not succeeded.")
    output = execution.get("content", {})
    if output.get("output-type") != "TEXT" or output.get("exit-code") != 0:
        raise KeySafetyError("Public fingerprint command failed; raw output suppressed.")
    match = re.fullmatch(r"256 (SHA256:[A-Za-z0-9+/]{43}) [^\n]*\(ED25519\)\s*", output.get("text", ""))
    if not match:
        raise KeySafetyError("Unexpected fingerprint-only output; no raw publication or SSH pin.")
    return {"algorithm": "ed25519", "fingerprint": match[1]}


def fetch_public_fingerprint(state, child, eligibility, *, clock=time.monotonic, sleep=time.sleep):
    entry = state.setdefault("fingerprintCommand", {})
    payload = command_payload(state["instanceId"], child)
    if not entry.get("id"):
        listed = infra.invoke(["instance-agent", "command", "list", "--compartment-id", child, "--all"])
        rows = listed.get("items") if isinstance(listed, dict) else listed
        found = [row for row in rows if row.get("display-name") == COMMAND]
        if len(found) > 1:
            raise KeySafetyError("Duplicate public-fingerprint command; no create.")
        if found:
            entry["id"] = ocid(found[0].get("id"), "instanceagentcommand")
        elif not entry.get("createRequested"):
            entry["eligibility"] = eligibility()
            entry["createRequested"] = True
            atomic_metadata(repair.STATE, state)
            print("CREATE CHECK: one read-only public host fingerprint command on same free stagingVM; no sudo/private keys/secret output/production.", flush=True)
            entry["id"] = ocid(infra.invoke(command_args(payload)).get("id"), "instanceagentcommand")
            atomic_metadata(repair.STATE, state)
        if not entry.get("id"):
            raise KeySafetyError("Ambiguous command create; never submit twice.")
    observed = infra.invoke(["instance-agent", "command", "get", "--command-id", entry["id"]])
    if not infra.contains(infra.canonical(observed), infra.canonical(payload)):
        raise KeySafetyError("Existing command content/target/timeout differs; no execution accepted.")
    # Identity propagation can take30minutes. This polls ONE command, never
    # repeats a create; explicit failed/cancelled states are immediate failures.
    entry.setdefault("waitStartedAt", time.time())
    atomic_metadata(repair.STATE, state)
    start = clock()
    remaining = max(0, 1800 - (time.time() - entry["waitStartedAt"]))
    delay = 5
    read_execution = lambda: infra.invoke(["instance-agent", "command-execution", "get", "--command-id", entry["id"], "--instance-id", state["instanceId"]])
    execution = wait_for_visible(read_execution, label="hostkey-command-execution")
    while True:
        lifecycle = execution.get("lifecycle-state")
        entry["lastState"] = lifecycle
        atomic_metadata(repair.STATE, state)
        if lifecycle == "SUCCEEDED":
            return parse_public_output(execution, entry["id"], state["instanceId"])
        if lifecycle not in ("ACCEPTED", "IN_PROGRESS"):
            raise KeySafetyError("Public fingerprint command failed: state=" + str(lifecycle) + "; raw output suppressed.")
        if clock() - start >= remaining:
            raise KeySafetyError("Command delivery exceeded documented30minute propagation window; no retry.")
        print("WAIT: same public-fingerprint command " + str(lifecycle) + "; no re-submit.", flush=True)
        sleep(min(delay, max(0, remaining - (clock() - start))))
        delay = min(delay * 2, 60)
        execution = read_execution()


def temporary_fallback(state, journal, cp, client):
    console = state.get("console", {})
    if not console.get("readComplete") or console.get("fingerprintBlockPresent") is not False or not console.get("deleted"):
        raise KeySafetyError("Temporary IAM is approved ONLY after absent console fingerprint block and capture cleanup.")
    child, root = cp["created"]["compartment"]["id"], client.profile["tenancy"]
    payloads = specs(state["instanceId"], child, root, journal["intent"])
    eligibility = lambda: infra.fresh_eligibility(client, journal, journal["created"]["instance"]["spec"]["availabilityDomain"])
    if not state.get("fallbackPublicFingerprint"):
        try:
            for kind in ("group", "policy"):
                ensure_one(state, kind, payloads[kind], eligibility)
            state["fallbackPublicFingerprint"] = fetch_public_fingerprint(state, child, eligibility)
            atomic_metadata(repair.STATE, state)
        finally:
            # Revoke the permission before removing the exact-VM membership.
            for kind in ("policy", "group"):
                remove_one(state, kind, payloads[kind])
    else:
        for kind in ("policy", "group"):
            remove_one(state, kind, payloads[kind])
    if not all(state["temporaryIam"][kind].get("deleted") for kind in ("group", "policy")):
        raise KeySafetyError("Temporary IAM cleanup must PASS before SSH enrollment.")
    return state["fallbackPublicFingerprint"]
