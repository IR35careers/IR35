#!/usr/bin/env python3
"""Fixed P1 associations/private empty bucket/free email notification resources."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

from bootstrap_audit import KEY_DIRECTORY, ocid
from key_ceremony import KeySafetyError
import p1_control_plane as control
import p1_infrastructure as infra
from resource_audit import ReadOnlyOci, inventory, session_account_audit
from security_session import atomic_metadata, ensure_session, private_file
from storage_budget import reconcile
from visibility import wait_for_visible

KINDS = {"attachment": "volumeattachment", "topic": "onstopic", "subscription": "onssubscription", "bucket": "bucket"}


def check_attachment_prerequisite(instance, image, payload):
    if ("compartment-id" not in image or image["compartment-id"] is not None
            or image.get("id") != instance.get("image-id") or image.get("listing-type") not in (None, "NONE")
            or image.get("operating-system") != "Canonical Ubuntu" or image.get("operating-system-version") != "24.04"
            or "aarch64" not in image.get("display-name", "")):
        raise KeySafetyError("Encrypted attachment requires the verified Oracle Ubuntu24.04 ARM platform image, not a custom image.")
    options = instance.get("launch-options", {})
    if options.get("remote-data-volume-type") != "PARAVIRTUALIZED":
        raise KeySafetyError("Encrypted data attachment requires PARAVIRTUALIZED, never iSCSI.")
    if options.get("is-pv-encryption-in-transit-enabled") is not True:
        raise KeySafetyError("Attachment blocked before API call: instance launchOptions.isPvEncryptionInTransitEnabled must be true.")
    if payload.get("isPvEncryptionInTransitEnabled") is not True or payload.get("instanceId") != instance.get("id"):
        raise KeySafetyError("Only an encrypted attachment to the verified existing instance is permitted.")
    return True


def attachment_prerequisite(journal, payload):
    instance = infra.invoke(infra.cli_arguments("instance", "get", resource_id=infra.identifier(journal, "instance")))
    infra.verify("instance", journal["created"]["instance"], instance)
    image = infra.invoke(["compute", "image", "get", "--image-id", ocid(instance.get("image-id"), "image")])
    return check_attachment_prerequisite(instance, image, payload)


def spec(kind, journal, child, namespace):
    tags = {"ir35-phase": "P1", "ir35-intent": journal["intent"]}
    common = {"compartmentId": child, "freeformTags": tags}
    if kind == "attachment":
        # The attachment API has no tags. Identity additionally requires the
        # independently tagged instance+volume, exact IDs and display name.
        return {"displayName": "ir35-staging-data", "instanceId": infra.identifier(journal, "instance"), "volumeId": infra.identifier(journal, "volume"),
                "isReadOnly": False, "isShareable": False, "isPvEncryptionInTransitEnabled": True}
    if kind == "topic":
        return {**common, "name": "ir35-alerts", "description": "IR35 Always Free staging health notifications"}
    if kind == "subscription":
        return {**common, "topicId": journal["created"]["topic"]["id"], "protocol": "EMAIL", "subscriptionEndpoint": "info@ir35careers.com"}
    if kind == "bucket":
        return {**common, "namespaceName": namespace, "name": "ir35-backups", "storageTier": "Standard", "publicAccessType": "NoPublicAccess",
                "versioning": "Disabled", "autoTiering": "Disabled", "objectEventsEnabled": False}
    raise KeySafetyError("Unsupported finish resource.")


def args(kind, operation, payload, child, resource_id=None):
    prefix = {"attachment": ["compute", "volume-attachment"], "topic": ["ons", "topic"], "subscription": ["ons", "subscription"], "bucket": ["os", "bucket"]}[kind]
    if operation == "create":
        command = "attach-paravirtualized-volume" if kind == "attachment" else "create"
        result = [*prefix, command]
        for key, value in payload.items():
            option = "--" + re.sub(r"[A-Z]", lambda m: "-" + m[0].lower(), key)
            result += [option, value if isinstance(value, str) else json.dumps(value)]
        return result
    if operation == "get":
        if kind == "bucket":
            return [*prefix, "get", "--namespace-name", payload["namespaceName"], "--bucket-name", payload["name"]]
        selector = {"attachment": "volume-attachment-id", "topic": "topic-id", "subscription": "subscription-id"}[kind]
        return [*prefix, "get", "--" + selector, ocid(resource_id, KINDS[kind])]
    if operation == "list":
        result = [*prefix, "list", "--compartment-id", child, "--all"]
        if kind == "attachment":
            result += ["--instance-id", payload["instanceId"]]
        if kind == "subscription":
            result += ["--topic-id", payload["topicId"]]
        if kind == "bucket":
            # BucketSummary excludes tags unless explicitly requested. Keep the
            # collision check strict rather than treating absent tags as owned.
            result += ["--namespace-name", payload["namespaceName"], "--fields", "tags"]
        return result
    raise KeySafetyError("Unsupported finish operation.")


def rows(value):
    if isinstance(value, dict) and set(value) == {"items"}:
        value = value["items"]
    if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
        raise KeySafetyError("Incomplete resource list; no second create.")
    return value


def reconciliation_order(journal):
    kinds = ("attachment", "topic", "subscription", "bucket")
    pending = journal.get("pending")
    if not pending:
        return kinds
    kind = pending.get("kind")
    if kind not in kinds:
        raise KeySafetyError("Unknown pending finish resource; no create.")
    # Resolve the durable pending intent before revisiting completed parents.
    # create_one still rejects any different pending kind, preserving no-duplicate
    # protection when the previous process stopped after a successful create.
    return (kind, *(item for item in kinds if item != kind))


def matches(kind, payload, child):
    result = rows(infra.invoke(args(kind, "list", payload, child)))
    if kind == "attachment":
        found = [row for row in result if row.get("volume-id") == payload["volumeId"] and row.get("lifecycle-state") != "DETACHED"]
    elif kind == "subscription":
        found = [row for row in result if row.get("endpoint") == payload["subscriptionEndpoint"] and row.get("protocol") == "EMAIL" and row.get("lifecycle-state") != "DELETED"]
    else:
        found = [row for row in result if row.get("name") == payload["name"] and row.get("lifecycle-state") != "DELETED"]
    if len(found) > 1:
        raise KeySafetyError("Duplicate finish resource; no create.")
    if kind != "attachment" and any(row.get("freeform-tags") != payload["freeformTags"] or row.get("compartment-id") != child for row in found):
        raise KeySafetyError("Finish resource name/tag/parent collision; no create.")
    return found


def resource_id(kind, row):
    return ocid(row.get("topic-id") if kind == "topic" else row.get("id"), KINDS[kind])


def verify(kind, payload, result):
    expected = dict(payload)
    state = result.get("lifecycle-state")
    if state in ("CREATING", "ATTACHING", "UPDATING"):
        identity_keys = ("displayName", "instanceId", "volumeId") if kind == "attachment" else ("compartmentId", "freeformTags")
        if not infra.contains(infra.canonical(result), infra.canonical({key: payload[key] for key in identity_keys})):
            raise KeySafetyError("Pending finish resource identity mismatch.")
        return None
    if kind == "bucket":
        expected["namespace"] = expected.pop("namespaceName")
    if kind == "subscription":
        expected["endpoint"] = expected.pop("subscriptionEndpoint")
    if not infra.contains(infra.canonical(result), infra.canonical(expected)):
        raise KeySafetyError("Finish read-back spec mismatch: " + kind + "; raw values suppressed.")
    if kind == "attachment" and state != "ATTACHED":
        raise KeySafetyError("Data attachment not attached; no host mount.")
    if kind == "topic" and state != "ACTIVE":
        raise KeySafetyError("Notification topic not ACTIVE.")
    if kind == "subscription" and state not in ("PENDING", "ACTIVE"):
        raise KeySafetyError("Unexpected email subscription state.")
    return resource_id(kind, result)


def create_one(kind, journal, child, payload, eligibility, *, prerequisite=None):
    if kind == "attachment":
        if prerequisite is None or prerequisite() is not True:
            raise KeySafetyError("Encrypted instance prerequisite must PASS before any attachment API call.")
    pending = journal.get("pending")
    entry = journal["created"].get(kind) or pending
    if pending and pending.get("kind") != kind:
        raise KeySafetyError("Pending finish resource must reconcile before any create.")
    if entry and entry.get("spec") != payload:
        raise KeySafetyError("Recorded finish specification differs; no create.")
    if not entry:
        found = matches(kind, payload, child)
        entry = {"kind": kind, "spec": payload}
        if found:
            # BucketSummary has no OCID. Its strict name/tags/compartment
            # match proves existence, not the full identity: get that below
            # from an independent bucket GET, never create another bucket.
            if kind != "bucket":
                entry["id"] = resource_id(kind, found[0])
        else:
            entry["eligibility"] = eligibility()
        journal["pending"] = entry
        atomic_metadata(infra.JOURNAL, journal)
        if not found:
            print("CREATE CHECK: " + kind + "; Always Free/no-charge association, free Notifications or empty private Standard bucket; live150GB/fivebackups/object8GB caps, London. No production.", flush=True)
            result = infra.invoke(args(kind, "create", payload, child))
            entry["id"] = resource_id(kind, result)
            atomic_metadata(infra.JOURNAL, journal)
    def read():
        found = matches(kind, payload, child)
        identifier = entry.get("id")
        if found and kind != "bucket":
            found_id = resource_id(kind, found[0])
            if identifier and identifier != found_id:
                raise KeySafetyError("Finish identity changed; no create.")
            identifier = found_id
        if not identifier and not (kind == "bucket" and found):
            return None
        observed = infra.invoke(args(kind, "get", payload, child, identifier))
        if identifier and resource_id(kind, observed) != identifier:
            raise KeySafetyError("Independent finish GET identity mismatch.")
        if kind == "subscription":
            entry["subscriptionState"] = observed.get("lifecycle-state")
        return verify(kind, payload, observed)
    identifier = wait_for_visible(read, label=kind, record=infra.recorder(journal, entry))
    from datetime import datetime, timezone
    journal["created"][kind] = {**entry, "id": identifier, "verifiedAt": datetime.now(timezone.utc).isoformat()}
    journal["pending"] = None
    atomic_metadata(infra.JOURNAL, journal)
    print("PASS: " + kind + " independent read-back; OCID=" + identifier, flush=True)


def main():
    if sys.argv[1:] != ["provision"]:
        raise KeySafetyError("Fixed finish provisioning only.")
    receipt = json.loads(private_file(control.PREFLIGHT_RECEIPT))
    if (receipt.get("status") != "PASS" or not 0 <= time.time() - receipt["checkedAt"] <= 1800
            or receipt.get("finishSHA256") != hashlib.sha256(Path(__file__).read_bytes()).hexdigest()):
        raise KeySafetyError("Current-source finish CLI proof required.")
    os.umask(0o077)
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = json.loads(private_file(infra.JOURNAL))
        if journal.get("stop"):
            raise KeySafetyError("P1 held on recorded real failure; no further create or automatic retry.")
        if journal.get("guestMountComplete") is not True:
            raise KeySafetyError("Verified UUID mount and reboot persistence required before remaining P1 creates.")
        cp = json.loads(private_file(control.JOURNAL))
        child = cp["created"]["compartment"]["id"]
        ad = journal["created"]["instance"]["spec"]["availabilityDomain"]
        client = ReadOnlyOci(ensure_session())
        client.compartments.add(child)
        # Attachment ownership comes from both exact tagged parents; the OCI
        # attachment API cannot carry freeform tags of its own.
        for kind in ("instance", "volume"):
            observed = infra.invoke(infra.cli_arguments(kind, "get", resource_id=infra.identifier(journal, kind)))
            infra.verify(kind, journal["created"][kind], observed)
        namespace = client.read("namespace")
        if not isinstance(namespace, str) or not re.fullmatch(r"[a-z0-9]{1,63}", namespace):
            raise KeySafetyError("Invalid private bucket namespace metadata.")
        for kind in reconciliation_order(journal):
            payload = spec(kind, journal, child, namespace)
            create_one(kind, journal, child, payload, lambda: infra.fresh_eligibility(client, journal, ad),
                       prerequisite=(lambda: attachment_prerequisite(journal, payload)) if kind == "attachment" else None)
        objects = infra.invoke(["os", "object", "list", "--namespace-name", namespace, "--bucket-name", "ir35-backups", "--all"])
        if isinstance(objects, dict) and "objects" in objects:
            objects = objects["objects"]
        if objects != []:
            raise KeySafetyError("New backup bucket must be exactly empty; no object deletion or assumption.")
        report = inventory(client, session_account_audit(client))
        if report["objectStorage"]["buckets"] != 1 or report["objectStorage"]["approximateBytes"] != "0":
            raise KeySafetyError("Unexpected tenancy bucket usage; no free-envelope signoff.")
        # Empty full listing + never-versioned bucket is exact zero byte proof.
        report["objectStorage"]["exactBytesProven"] = True
        journal["finalStorageReadback"] = reconcile(report)
        from p1_compute import verify_network
        journal["finalNetworkReadback"] = verify_network(journal)
        journal["resourceProvisioningComplete"] = True
        atomic_metadata(infra.JOURNAL, journal)
        print("P1 resources PASS: one2/12VM, live150GB, emptyprivateStandardbucket0bytes, no broadSSH. Email subscription confirmation/delivery remains owner/P8 check. No production/app deploy.", flush=True)
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: finish operation failed; raw output suppressed, durable intent retained. No retry.", file=sys.stderr)
        raise SystemExit(1)
