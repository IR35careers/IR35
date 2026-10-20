#!/usr/bin/env python3
"""Guarded first P1 resources only: ir35 compartment and restrictive quotas.

No VM/network/volume/bucket/production adapter or arbitrary OCI command escape.
Future resources require their own reviewed specifications and read-back checks.
"""
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

from bootstrap_audit import KEY_DIRECTORY, ocid
from key_ceremony import KeySafetyError, private_directory, write_new
from resource_audit import ReadOnlyOci, inventory, session_account_audit, SHAPE
from resource_audit import number
from security_session import atomic_metadata, clean_environment, command, ensure_session, private_file
from storage_budget import reconcile

JOURNAL = KEY_DIRECTORY / "p1-control-plane.json"
PREFLIGHT_RECEIPT = KEY_DIRECTORY / "quota-cli-wiring-status.json"
QUOTA_NAME = "ir35-always-free-cap"


def quota_statements():
    # Owner's exact root policy. These three quotas are AD-scoped: never claim
    # they replace the executor's tenancy-wide2/12/150 and five-backup guards.
    return ["set compute-core quota standard-a1-core-count to 2 in compartment ir35",
            "set compute-memory quota standard-a1-memory-count to 12 in compartment ir35",
            "set block-storage quota total-storage-gb to 150 in compartment ir35"]


def spec(kind, root, child, ad, intent):
    root = ocid(root, "tenancy")
    tags = {"ir35-phase": "P1", "ir35-intent": str(uuid.UUID(intent))}
    if kind == "compartment":
        return {"compartmentId": root, "name": "ir35", "description": "IR35 Always Free staging; no production cutover",
                "freeformTags": tags}
    if kind == "quota":
        ocid(child, "compartment")  # Target must exist; policy itself lives at root.
        return {"compartmentId": root, "name": QUOTA_NAME,
                "description": "Cap ir35 to Always Free envelope",
                "statements": quota_statements(), "freeformTags": tags}
    raise KeySafetyError("Only the approved compartment/quota bootstrap is implemented; no generic create.")


def arguments(kind, payload):
    # payload is produced exclusively by spec(), not accepted from a CLI file.
    commands = {"compartment": ["iam", "compartment", "create"], "quota": ["limits", "quota", "create"]}
    if kind not in commands:
        raise KeySafetyError("Unimplemented P1 create kind refused.")
    result = list(commands[kind])
    for name, value in payload.items():
        option = "--" + re.sub(r"[A-Z]", lambda item: "-" + item[0].lower(), name)
        result.extend([option, json.dumps(value, separators=(",", ":")) if isinstance(value, (dict, list)) else value])
    return result


def quota_read_arguments(operation, *, root=None, identifier=None):
    if operation == "list" and identifier is None:
        return ["limits", "quota", "list", "--compartment-id", ocid(root, "tenancy"), "--all"]
    if operation == "get" and root is None:
        return ["limits", "quota", "get", "--quota-id", ocid(identifier, "quota")]
    raise KeySafetyError("Quota reads must use limits quota get/list with exact selectors.")


def invoke(args):
    # Only fixed internally built create/get arrays reach this private function.
    ensure_session()
    result = subprocess.run(command(args), capture_output=True, text=True, timeout=65, env=clean_environment(), check=False)
    if result.returncode:
        code = re.search(r'"code"\s*:\s*"([A-Za-z][A-Za-z0-9_]{0,63})"', result.stderr)
        status = re.search(r'"status"\s*:\s*(\d{3})', result.stderr)
        raise KeySafetyError("OCI bootstrap failed: code=" + (code[1] if code else "CLIError")
                             + "; status=" + (status[1] if status else "unknown") + "; pending intent retained; no retry.")
    try:
        if len(result.stdout) > 1_000_000:
            raise ValueError()
        data = json.loads(result.stdout)["data"]
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, KeyError, TypeError):
        raise KeySafetyError("Incomplete bootstrap result; pending intent retained, reconcile before any create.") from None


def check_readback(kind, payload, result):
    identifier = ocid(result.get("id"), kind)
    if (result.get("name") != payload["name"] or result.get("compartment-id") != payload["compartmentId"]
            or result.get("freeform-tags") != payload["freeformTags"] or result.get("lifecycle-state") != "ACTIVE"):
        raise KeySafetyError("Created resource identity/state/tags differ; retain intent and stop.")
    if kind == "quota" and result.get("statements") != payload["statements"]:
        raise KeySafetyError("Quota statements differ on read-back; no VM/volume creation permitted.")
    return identifier


def fresh_evidence(client, ad=None):
    account = session_account_audit(client)
    report = inventory(client, account)
    # Reserve the complete eventual50+100GB envelope, not merely a small create.
    # This bootstrap cannot run after any VM/volume has been allocated.
    if report["usage"]["instances"] != 0 or report["usage"]["liveVolumeGB"] != "0":
        raise KeySafetyError("Bootstrap expects no existing VM/volume allocation; stop for reconciliation.")
    storage = reconcile(report, add_live_gb=150)
    available = [item["domain"] for item in report["availabilityDomains"]
                 if float(item["ocpus"]["available"]) >= 2 and float(item["memoryGB"]["available"]) >= 12]
    if not available or (ad is not None and ad not in available):
        raise KeySafetyError("No eligible quota-available London AD for the2/12 target; no create.")
    selected = ad or sorted(available)[0]
    shapes = [item for item in client.read("shapes", ad=selected) if item.get("shape") == SHAPE]
    if len(shapes) != 1 or shapes[0].get("billing-type") not in ("ALWAYS_FREE", "LIMITED_FREE") or shapes[0].get("is-flexible") is not True:
        raise KeySafetyError("Live A1 free billing/flexible metadata did not pass; no create.")
    return {"checkedAt": report["checkedAt"], "account": account, "inventory": report,
            "storage": storage, "selectedAD": selected, "shapeBilling": shapes[0]["billing-type"],
            "quotaDefinitions": verify_quota_names(client)}


def verify_quota_names(client):
    expected = {"compute": {"standard-a1-core-count", "standard-a1-memory-count"}, "block-storage": {"total-storage-gb"}}
    proof = []
    for service, names in expected.items():
        definitions = client.read("quotaDefinitions", service=service)
        if not isinstance(definitions, list):
            raise KeySafetyError("Quota definitions are incomplete; no create.")
        for name in sorted(names):
            matches = [row for row in definitions if row.get("name") == name]
            if len(matches) != 1 or matches[0].get("are-quotas-supported") is not True or matches[0].get("scope-type") != "AD":
                raise KeySafetyError("Documented quota definition/support/scope unverified: " + name + "; no create.")
            proof.append({"service": service, "name": name, "scope": "AD", "quotasSupported": True})
    return proof


def wait_for_quota(journal, client, *, clock=time.monotonic, sleep=time.sleep):
    """Expected propagation polling only, never a create retry; max10minutes."""
    quota = journal["created"]["quota"]
    root = client.profile["tenancy"]
    listed = client.read("quotas", compartment=root)
    matches = [row for row in listed if row.get("id") == quota["id"] and row.get("name") == QUOTA_NAME
               and row.get("compartment-id") == root and row.get("lifecycle-state") == "ACTIVE"]
    if len(matches) != 1:
        raise KeySafetyError("Root limits quota list did not verify the unique ACTIVE policy; no launch.")
    child = journal["created"]["compartment"]["id"]
    client.compartments.add(child)
    if not client.domains:
        client.domains = {row["name"] for row in client.read("domains")}
    deadline = clock() + 600
    checks = {"standard-a1-core-count": 2, "standard-a1-memory-count": 12, "total-storage-gb": 150}
    polls = 0
    while True:
        polls += 1
        values = {}
        for name, target in checks.items():
            result = client.read("quotaAvailability", compartment=child, ad=journal["selectedAD"], limit=name)
            if not isinstance(result, dict):
                raise KeySafetyError("Effective quota response is incomplete; no launch.")
            observed = result.get("effective-quota-value")
            values[name] = None if observed is None else str(number(observed))
        if all(values[name] is not None and number(values[name]) == target for name, target in checks.items()):
            quota["effectiveReadback"] = {"limits": values, "polls": polls, "verifiedAt": datetime.now(timezone.utc).isoformat(),
                                          "scope": "selected AD within ir35; aggregate executor guards still required"}
            atomic_metadata(JOURNAL, journal)
            print("PASS: root quota listed ACTIVE and effective child/AD limits are2/12/150; aggregate free envelope unchanged.", flush=True)
            return quota["effectiveReadback"]
        remaining = deadline - clock()
        if remaining <= 0:
            raise KeySafetyError("Quota propagation did not reach2/12/150 within10minutes; no launch, no create retry.")
        print("WAIT: quota propagation pending; no launch or extra create.", flush=True)
        sleep(min(30, remaining))


def create_one(kind, journal, client):
    if kind in journal["created"]:
        previous = journal["created"][kind]
        payload = previous["spec"]
        args = ["iam", "compartment", "get", "--compartment-id", previous["id"]] if kind == "compartment" else quota_read_arguments("get", identifier=previous["id"])
        check_readback(kind, payload, invoke(args))
        return previous["id"]
    if journal.get("pending"):
        raise KeySafetyError("A pending create exists: reconcile its resource, never reset or retry blindly.")
    evidence = fresh_evidence(client, journal.get("selectedAD"))
    journal["selectedAD"] = evidence["selectedAD"]
    # Refuse name collisions; never adopt/edit an unrelated existing resource.
    if kind == "compartment":
        collisions = [row for row in client.read("compartments") if row.get("name") == "ir35" and row.get("lifecycle-state") != "DELETED"]
    else:
        child = journal["created"]["compartment"]["id"]
        client.compartments.add(child)
        collisions = [row for row in client.read("quotas", compartment=client.profile["tenancy"]) if row.get("name") == QUOTA_NAME]
    if collisions:
        raise KeySafetyError("Unowned target resource name already exists; no create/adoption.")
    payload = spec(kind, client.profile["tenancy"], journal["created"].get("compartment", {}).get("id"),
                   journal["selectedAD"], str(uuid.uuid4()))
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    print("CREATE CHECK: " + kind + "; IAM/quota control-plane, no VM/shape/volume allocation. "
          "Always Free/no service charge; London ACTIVE Free Trial freshly verified; future ceiling A1 2OCPU/12GB, live150GB, five backups, Standard object8GB. "
          "Existing GBP1 budget verified; no production/upgrade/cutover. specSHA256=" + digest, flush=True)
    print("Eligibility: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm", flush=True)
    journal["pending"] = {"kind": kind, "spec": payload, "specSHA256": digest, "evidence": evidence}
    atomic_metadata(JOURNAL, journal)  # fsync durable intent BEFORE mutation.
    result = invoke(arguments(kind, payload))
    identifier = ocid(result.get("id"), kind)
    journal["pending"]["responseId"] = identifier
    atomic_metadata(JOURNAL, journal)
    args = ["iam", "compartment", "get", "--compartment-id", identifier] if kind == "compartment" else quota_read_arguments("get", identifier=identifier)
    check_readback(kind, payload, invoke(args))  # Independent GET, never just create response.
    journal["created"][kind] = {"id": identifier, "spec": payload, "verifiedAt": datetime.now(timezone.utc).isoformat()}
    journal["pending"] = None
    atomic_metadata(JOURNAL, journal)
    print("PASS: " + kind + " independently read back ACTIVE; owner-only journal saved. OCID=" + identifier, flush=True)
    return identifier


def main():
    # Owner explicitly reopened this one fix. Actual vendor-parser PASS receipt
    # must bind the current adapter bytes, correct namespace and session auth.
    try:
        receipt = json.loads(private_file(PREFLIGHT_RECEIPT))
        age = time.time() - receipt["checkedAt"]
        if (receipt.get("status") != "PASS" or receipt.get("group") != "limits quota"
                or receipt.get("auth") != "security_token" or not 0 <= age <= 1800
                or receipt.get("sourceSHA256") != hashlib.sha256(Path(__file__).read_bytes()).hexdigest()):
            raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        raise KeySafetyError("P1 held: missing/stale/mismatched quota wiring PASS; no create enabled.") from None
    bootstrap()


def bootstrap():
    if sys.argv[1:] != ["bootstrap"]:
        raise KeySafetyError("Use bootstrap only. No general apply or arbitrary resource operation.")
    os.umask(0o077)
    private_directory(KEY_DIRECTORY)
    lock = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if JOURNAL.exists():
            journal = json.loads(private_file(JOURNAL))
            if set(journal) != {"version", "created", "pending", "selectedAD"} or journal["version"] != 1:
                raise KeySafetyError("Unrecognised journal; no reset or create.")
        else:
            journal = {"version": 1, "created": {}, "pending": None, "selectedAD": None}
            write_new(JOURNAL, json.dumps(journal).encode())
        client = ReadOnlyOci(ensure_session())
        child = create_one("compartment", journal, client)
        client.compartments.add(child)
        create_one("quota", journal, client)
        wait_for_quota(journal, client)
        print("Control-plane bootstrap PASS. P1 is NOT complete: VM/network/storage/Bastion adapters remain guarded/unexecuted.")
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: bootstrap failed; raw provider output suppressed, pending journal retained. No retry.", file=sys.stderr)
        raise SystemExit(1)
