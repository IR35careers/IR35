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
from visibility import OciError, wait_for_visible, call_timeout

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
    result = subprocess.run(command(args), capture_output=True, text=True, timeout=call_timeout(), env=clean_environment(), check=False)
    if result.returncode:
        raise OciError.from_stderr("bootstrap-" + args[2], result.stderr)
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
    """Root visibility AND child enforcement share one ten-minute deadline."""
    quota = journal["created"]["quota"]
    root = client.profile["tenancy"]
    child = journal["created"]["compartment"]["id"]
    client.compartments.add(child)
    if not client.domains:
        client.domains = {row["name"] for row in client.read("domains")}
    checks = {"standard-a1-core-count": 2, "standard-a1-memory-count": 12, "total-storage-gb": 150}
    polls = 0
    def read():
        nonlocal polls
        polls += 1
        listed = client.read("quotas", compartment=root)
        matches = [row for row in listed if row.get("name") == QUOTA_NAME]
        if not matches:
            return None
        if len(matches) != 1 or matches[0].get("id") != quota["id"] or matches[0].get("compartment-id") != root:
            raise KeySafetyError("Root quota list identity mismatch; no launch.")
        if "spec" in quota:
            # OCI QuotaSummary has no statements field. The independent GET
            # already verifies statements; list verifies identity/tags/state.
            if matches[0].get("freeform-tags") != quota["spec"]["freeformTags"]:
                raise KeySafetyError("Root quota list tags differ; no launch.")
            if matches[0].get("lifecycle-state") != "ACTIVE":
                return None
        elif matches[0].get("lifecycle-state") != "ACTIVE":
            return None
        values = {}
        for name, target in checks.items():
            result = client.read("quotaAvailability", compartment=child, ad=journal["selectedAD"], limit=name)
            if not isinstance(result, dict):
                raise KeySafetyError("Effective quota response is incomplete; no launch.")
            observed = result.get("effective-quota-value")
            values[name] = None if observed is None else str(number(observed))
        if all(values[name] is not None and number(values[name]) == target for name, target in checks.items()):
            return {"limits": values, "polls": polls, "verifiedAt": datetime.now(timezone.utc).isoformat(),
                    "scope": "selected AD within ir35; aggregate executor guards still required"}
        return None
    result = wait_for_visible(read, label="quota-effective", record=journal_recorder(journal, quota, "effectiveVisibility"),
                              clock=clock, sleep=sleep)
    quota["effectiveReadback"] = result
    atomic_metadata(JOURNAL, journal)
    print("PASS: root quota listed ACTIVE and effective child/AD limits are2/12/150; aggregate free envelope unchanged.", flush=True)
    return result


def journal_recorder(journal, entry, field="visibility"):
    def record(event):
        entry.setdefault(field, []).append(event)
        atomic_metadata(JOURNAL, journal)
    return record


def lookup(kind, client):
    if kind == "compartment":
        return [row for row in client.read("compartments") if row.get("name") == "ir35" and row.get("lifecycle-state") != "DELETED"]
    if kind == "quota":
        return [row for row in client.read("quotas", compartment=client.profile["tenancy"]) if row.get("name") == QUOTA_NAME]
    raise KeySafetyError("Unimplemented lookup kind.")


def visible_resource(kind, entry, client):
    # Always name+tag lookup first; a list that has not propagated may be empty.
    matches = lookup(kind, client)
    if len(matches) > 1 or any(row.get("freeform-tags") != entry["spec"]["freeformTags"] for row in matches):
        raise KeySafetyError("Duplicate or unowned target name; no adoption or second create.")
    identifier = entry.get("id") or entry.get("responseId")
    if matches:
        found = ocid(matches[0].get("id"), kind)
        if identifier is not None and found != identifier:
            raise KeySafetyError("Recorded resource and name/tag lookup disagree; no create.")
        identifier = found
    if identifier is None:
        return None
    args = ["iam", "compartment", "get", "--compartment-id", identifier] if kind == "compartment" else quota_read_arguments("get", identifier=identifier)
    result = invoke(args)
    if (result.get("id") != identifier or result.get("name") != entry["spec"]["name"]
            or result.get("compartment-id") != entry["spec"]["compartmentId"]
            or result.get("freeform-tags") != entry["spec"]["freeformTags"]):
        raise KeySafetyError("Resource identity/tags differ; no create.")
    if result.get("lifecycle-state") in ("CREATING", "UPDATING"):
        return None
    return check_readback(kind, entry["spec"], result)


def create_one(kind, journal, client):
    if kind in journal["created"]:
        previous = journal["created"][kind]
        return wait_for_visible(lambda: visible_resource(kind, previous, client), label=kind,
                                record=journal_recorder(journal, previous))
    if journal.get("pending"):
        if journal["pending"].get("kind") != kind:
            raise KeySafetyError("Different pending create must reconcile first; no create.")
        entry = journal["pending"]
    else:
        matches = lookup(kind, client)
        if len(matches) > 1:
            raise KeySafetyError("Duplicate target name; no create/adoption.")
        intent = str(uuid.uuid4())
        if matches:
            tags = matches[0].get("freeform-tags", {})
            try:
                intent = str(uuid.UUID(tags["ir35-intent"]))
            except (KeyError, TypeError, ValueError):
                raise KeySafetyError("Unowned target resource name already exists; no create/adoption.") from None
        payload = spec(kind, client.profile["tenancy"], journal["created"].get("compartment", {}).get("id"), journal["selectedAD"], intent)
        if matches:
            if (matches[0].get("freeform-tags") != payload["freeformTags"]
                    or matches[0].get("compartment-id") != payload["compartmentId"]):
                raise KeySafetyError("Existing name/tags/parent mismatch; no create/adoption.")
            entry = {"kind": kind, "spec": payload, "responseId": matches[0]["id"], "reusedByNameAndTags": True}
            journal["pending"] = entry
            atomic_metadata(JOURNAL, journal)
        else:
            evidence = fresh_evidence(client, journal.get("selectedAD"))
            journal["selectedAD"] = evidence["selectedAD"]
            digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
            print("CREATE CHECK: " + kind + "; IAM/quota control-plane, no VM/shape/volume allocation. "
                  "Always Free/no service charge; London ACTIVE Free Trial freshly verified; future ceiling A1 2OCPU/12GB, live150GB, five backups, Standard object8GB. "
                  "Existing GBP1 budget verified; no production/upgrade/cutover. specSHA256=" + digest, flush=True)
            entry = {"kind": kind, "spec": payload, "specSHA256": digest, "evidence": evidence}
            journal["pending"] = entry
            atomic_metadata(JOURNAL, journal)  # fsync intent BEFORE exactly one mutation.
            result = invoke(arguments(kind, payload))
            entry["responseId"] = ocid(result.get("id"), kind)
            atomic_metadata(JOURNAL, journal)
    identifier = wait_for_visible(lambda: visible_resource(kind, entry, client), label=kind,
                                  record=journal_recorder(journal, entry))
    journal["created"][kind] = {**entry, "id": identifier, "verifiedAt": datetime.now(timezone.utc).isoformat()}
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
