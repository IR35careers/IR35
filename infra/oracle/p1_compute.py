#!/usr/bin/env python3
"""Continue P1 after verified network: private Bastion SSH, one2/12 A1 +100GB."""
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import sys
import time

from bootstrap_audit import KEY_DIRECTORY
from key_ceremony import KeySafetyError
import p1_control_plane as control
import p1_infrastructure as infra
from resource_audit import ReadOnlyOci, SHAPE
from security_session import atomic_metadata, ensure_session, private_file
from ssh_agent_session import ensure_agent
from visibility import OciError, wait_for_visible


def bastion_ingress(journal):
    bastion = infra.invoke(infra.cli_arguments("bastion", "get", resource_id=infra.identifier(journal, "bastion")))
    infra.verify("bastion", journal["created"]["bastion"], bastion)
    source = infra.source_cidr(bastion.get("private-endpoint-ip-address", "") + "/32", private=True)
    if journal.get("bastionCIDR") not in (None, source):
        raise KeySafetyError("Bastion endpoint changed; no silent ingress widening.")
    desired = infra.ingress(journal["ownerCIDR"], source)
    entry = journal["created"]["security"]
    read_args = infra.cli_arguments("security", "get", resource_id=entry["id"])
    actual = infra.invoke(read_args)
    if not infra.contains(infra.canonical(actual.get("ingress-security-rules")), infra.canonical(desired)):
        # Verify complete original desired state before a narrowly scoped update.
        infra.verify("security", entry, actual)
        journal["ingressUpdate"] = {"resource": entry["id"], "bastionCIDR": source, "status": "pending"}
        atomic_metadata(infra.JOURNAL, journal)
        infra.invoke(["network", "security-list", "update", "--security-list-id", entry["id"], "--force",
                      "--ingress-security-rules", json.dumps(desired), "--egress-security-rules", json.dumps(infra.EGRESS)])
    expected = {**entry["spec"], "ingressSecurityRules": desired}
    def read():
        result = infra.invoke(read_args)
        if result.get("lifecycle-state") == "UPDATING":
            return None
        infra.verify("security", {"spec": expected}, result)
        return True
    wait_for_visible(read, label="bastion-ssh-ingress", record=infra.recorder(journal, entry))
    journal["bastionCIDR"] = source
    entry["spec"] = expected
    journal["ingressUpdate"] = {"resource": entry["id"], "status": "verified", "privateSourceOnly": True}
    atomic_metadata(infra.JOURNAL, journal)


def verify_network(journal):
    subnet = infra.invoke(infra.cli_arguments("subnet", "get", resource_id=infra.identifier(journal, "subnet")))
    infra.verify("subnet", journal["created"]["subnet"], subnet)
    if subnet.get("security-list-ids") != [infra.identifier(journal, "security")]:
        raise KeySafetyError("Unexpected attached/default security list; no launch.")
    security = infra.invoke(infra.cli_arguments("security", "get", resource_id=infra.identifier(journal, "security")))
    infra.verify("security", journal["created"]["security"], security)
    rules = infra.invoke(["network", "nsg", "rules", "list", "--nsg-id", infra.identifier(journal, "nsg"), "--all"])
    if isinstance(rules, dict) and set(rules) == {"items"}:
        rules = rules["items"]
    if rules != []:
        raise KeySafetyError("Unexpected NSG rules; only explicit restricted security list allowed.")
    return {"onlyPublicPorts": [80, 443], "sshOwnerSlash32": True, "sshBastionPrivateSlash32": True,
            "broadIpv4OrIpv6Ssh": False, "noDefaultSecurityListAttached": True}


def launch(journal, client, child, first_ad, image, key, *, clock=time.time, sleep=time.sleep):
    history = journal.setdefault("capacity", {"startedAt": clock(), "attempts": []})
    if history.get("halted"):
        raise KeySafetyError("Previous non-capacity failure; stop and reconcile, no new launch attempt.")
    # Persist BEFORE any launch. Unknown results retain pending and never retry.
    atomic_metadata(infra.JOURNAL, journal)
    while True:
        attempts = history["attempts"]
        existing = journal["created"].get("instance") or journal.get("pending")
        ad = existing["spec"]["availabilityDomain"] if existing and existing.get("kind") == "instance" else (attempts[-1]["ad"] if attempts and attempts[-1].get("result") != "capacity" else first_ad)
        if not existing:
            if len(attempts) >= 4 or clock() - history["startedAt"] >= 7200:
                raise KeySafetyError("A1 capacity limit exhausted (initial+3retries/2hours); no paid shape or further launch.")
            if attempts:
                remaining = attempts[-1]["at"] + 600 - clock()
                while remaining > 0:
                    print("WAIT: proven A1 capacity rejection; bounded10minute launch backoff, no resource duplicate.", flush=True)
                    sleep(min(60, remaining))
                    remaining = attempts[-1]["at"] + 600 - clock()
                # Only inspected quota-available, free-billing London ADs qualify.
                domains = sorted(client.domains)
                eligible = []
                for candidate in domains:
                    values = [client.read("a1Availability", ad=candidate, limit=name) for name in ("standard-a1-core-count", "standard-a1-memory-count")]
                    if values[0].get("available", 0) >= 2 and values[1].get("available", 0) >= 12:
                        eligible.append(candidate)
                if not eligible:
                    raise KeySafetyError("No eligible free AD remains; no launch.")
                ad = eligible[len(attempts) % len(eligible)]
            attempts.append({"number": len(attempts) + 1, "ad": ad, "at": clock(), "result": "pending"})
            atomic_metadata(infra.JOURNAL, journal)
        payload = infra.specification("instance", journal, child, ad, image, key)
        try:
            result = infra.create_one("instance", journal, child, payload, lambda: infra.fresh_eligibility(client, journal, ad))
        except OciError as error:
            if not getattr(error, "capacity", False):
                history["halted"] = {"code": error.code, "status": error.status}
                atomic_metadata(infra.JOURNAL, journal)
                raise
            # A rejected request is known not to have created an instance.
            if not journal.get("pending") or journal["pending"].get("id"):
                raise KeySafetyError("Ambiguous capacity result; no launch retry.") from None
            attempts[-1]["result"] = "capacity"
            journal["capacityRejectedIntents"] = [*journal.get("capacityRejectedIntents", []), journal["pending"]]
            journal["pending"] = None
            atomic_metadata(infra.JOURNAL, journal)
            print("A1 Out of host capacity confirmed; attempt " + str(len(attempts)) + "/4; no shape substitution.", flush=True)
            continue
        attempts[-1]["result"] = "created"
        atomic_metadata(infra.JOURNAL, journal)
        return result, ad


def verify_compute(journal, child, ad):
    instance = infra.identifier(journal, "instance")
    attachments = infra.invoke(["compute", "vnic-attachment", "list", "--compartment-id", child, "--instance-id", instance, "--all"])
    attached = [row for row in attachments if row.get("lifecycle-state") == "ATTACHED"]
    if len(attached) != 1:
        raise KeySafetyError("Expected exactly one VNIC; no storage create.")
    vnic = infra.invoke(["network", "vnic", "get", "--vnic-id", attached[0]["vnic-id"]])
    if (vnic.get("subnet-id") != infra.identifier(journal, "subnet") or vnic.get("nsg-ids") != [infra.identifier(journal, "nsg")]
            or vnic.get("ipv6-addresses") or not ipaddress.ip_address(vnic.get("public-ip", "")).is_global):
        raise KeySafetyError("VM VNIC/subnet/NSG/public-IP readback mismatch.")
    boots = infra.invoke(["compute", "boot-volume-attachment", "list", "--compartment-id", child,
                          "--availability-domain", ad, "--instance-id", instance, "--all"])
    attached_boots = [row for row in boots if row.get("lifecycle-state") == "ATTACHED"]
    if len(attached_boots) != 1:
        raise KeySafetyError("Expected one boot attachment; no storage create.")
    boot = infra.invoke(["bv", "boot-volume", "get", "--boot-volume-id", attached_boots[0]["boot-volume-id"]])
    if boot.get("size-in-gbs") != 50 or boot.get("availability-domain") != ad or boot.get("vpus-per-gb") != 10:
        raise KeySafetyError("Boot volume must be50GB/Balanced in selected AD; no further allocation.")
    journal["computeReadback"] = {"publicIP": str(ipaddress.ip_address(vnic["public-ip"])), "bootVolumeId": boot["id"],
                                  "bootGB": 50, "network": verify_network(journal)}
    atomic_metadata(infra.JOURNAL, journal)
    print("PASS: actual VNIC/boot50GB/security union; VM publicIP=" + vnic["public-ip"], flush=True)


def official_image(images):
    eligible = [row for row in images if row.get("lifecycle-state") == "AVAILABLE" and row.get("operating-system") == "Canonical Ubuntu"
                and row.get("operating-system-version") == "24.04" and row.get("display-name", "").startswith("Canonical-Ubuntu-24.04-aarch64-")
                and "compartment-id" in row and row["compartment-id"] is None and row.get("listing-type") in (None, "NONE")]
    if not eligible:
        raise KeySafetyError("No official Ubuntu24.04 ARM/A1-compatible platform image; no launch.")
    return sorted(eligible, key=lambda row: row["display-name"])[-1]["id"]


def main():
    if sys.argv[1:] != ["provision"]:
        raise KeySafetyError("Fixed compute provision only.")
    receipt = json.loads(private_file(control.PREFLIGHT_RECEIPT))
    if (receipt.get("status") != "PASS" or not 0 <= time.time() - receipt["checkedAt"] <= 1800
            or receipt.get("computeSHA256") != hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
            or receipt.get("infrastructureSHA256") != hashlib.sha256(Path(infra.__file__).read_bytes()).hexdigest()):
        raise KeySafetyError("Current-source CLI wiring proof required before compute.")
    os.umask(0o077)
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        journal = json.loads(private_file(infra.JOURNAL))
        control_journal = json.loads(private_file(control.JOURNAL))
        child, ad = control_journal["created"]["compartment"]["id"], control_journal["selectedAD"]
        if not all(kind in journal["created"] for kind in ("vcn", "gateway", "routes", "security", "nsg", "subnet", "bastion")):
            raise KeySafetyError("Network/Bastion must PASS first.")
        if infra.owner_cidr() != journal["ownerCIDR"]:
            raise KeySafetyError("Owner IP changed; no silent ingress widening.")
        if not ensure_agent()["keyLoaded"]:
            raise KeySafetyError("Existing SSH key not in agent; owner gate, never repeat API prompt.")
        client = ReadOnlyOci(ensure_session())
        client.compartments.add(child)
        control.create_one("quota", control_journal, client)
        control.wait_for_quota(control_journal, client)
        bastion_ingress(journal)
        verify_network(journal)
        image = official_image(client.read("images"))
        # Read public key only; never open/decrypt a private key here.
        key = private_file(KEY_DIRECTORY / "ssh_ed25519.pub").strip()
        _, ad = launch(journal, client, child, ad, image, key)
        verify_compute(journal, child, ad)
        infra.create_one("volume", journal, child, infra.specification("volume", journal, child, ad),
                         lambda: infra.fresh_eligibility(client, journal, ad))
        print("VM+boot50GB+block100GB readbacks PASS; full P1 attachments/bucket/notification evidence still required.", flush=True)
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: compute operation failed; raw output suppressed, durable intent retained. No retry.", file=sys.stderr)
        raise SystemExit(1)
