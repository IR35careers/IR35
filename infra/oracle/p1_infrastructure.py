#!/usr/bin/env python3
"""Fixed London staging network/A1/volume executor. No production/app deploy."""
from datetime import datetime, timezone
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import uuid

from bootstrap_audit import KEY_DIRECTORY, ocid
from key_ceremony import KeySafetyError, private_directory, write_new
import p1_control_plane as control
from resource_audit import ReadOnlyOci, inventory, session_account_audit, SHAPE, number
from security_session import atomic_metadata, clean_environment, command, ensure_session, private_file
from storage_budget import reconcile
from visibility import OciError, wait_for_visible, call_timeout, service_error_detail

JOURNAL = KEY_DIRECTORY / "p1-infrastructure.json"
KINDS = {
    "vcn": ("network vcn", "vcn-id", "vcn", "AVAILABLE"),
    "gateway": ("network internet-gateway", "ig-id", "internetgateway", "AVAILABLE"),
    "routes": ("network route-table", "rt-id", "routetable", "AVAILABLE"),
    "security": ("network security-list", "security-list-id", "securitylist", "AVAILABLE"),
    "nsg": ("network nsg", "nsg-id", "networksecuritygroup", "AVAILABLE"),
    "subnet": ("network subnet", "subnet-id", "subnet", "AVAILABLE"),
    "bastion": ("bastion bastion", "bastion-id", "bastion", "ACTIVE"),
    "instance": ("compute instance", "instance-id", "instance", "RUNNING"),
    "volume": ("bv volume", "volume-id", "volume", "AVAILABLE"),
}
EGRESS = [{"destination": "0.0.0.0/0", "destinationType": "CIDR_BLOCK", "protocol": "all", "isStateless": False}]


def source_cidr(value, private=False):
    try:
        net = ipaddress.ip_network(value, strict=True)
        if net.version != 4 or net.prefixlen != 32 or (not private and not net.network_address.is_global):
            raise ValueError()
        if private and net.network_address not in ipaddress.ip_network("10.35.1.0/24"):
            raise ValueError()
        return str(net)
    except ValueError:
        raise KeySafetyError("SSH source must be exact owner public IPv4/32 or approved Bastion private/32.") from None


def ingress(owner, bastion=None):
    sources = [("0.0.0.0/0", 80), ("0.0.0.0/0", 443), (source_cidr(owner), 22)]
    if bastion:
        sources.append((source_cidr(bastion, True), 22))
    return [{"source": source, "sourceType": "CIDR_BLOCK", "protocol": "6", "isStateless": False,
             "tcpOptions": {"destinationPortRange": {"min": port, "max": port}}} for source, port in sources]


def identifier(journal, kind):
    return ocid(journal["created"][kind]["id"], KINDS[kind][2])


def specification(kind, journal, child, ad, image=None, public_key=None):
    if kind not in KINDS:
        raise KeySafetyError("Unimplemented infrastructure kind; no generic create.")
    name_key = "name" if kind == "bastion" else "displayName"
    payload = {"compartmentId": ocid(child, "compartment"), name_key: "ir35-staging-" + kind,
               "freeformTags": {"ir35-phase": "P1", "ir35-intent": str(uuid.UUID(journal["intent"]))}}
    if kind == "vcn":
        payload.update(cidrBlocks=["10.35.0.0/16"], dnsLabel="ir35", isIpv6Enabled=False)
    elif kind == "gateway":
        payload.update(vcnId=identifier(journal, "vcn"), isEnabled=True)
    elif kind == "routes":
        payload.update(vcnId=identifier(journal, "vcn"), routeRules=[{"destination": "0.0.0.0/0", "destinationType": "CIDR_BLOCK",
                       "networkEntityId": identifier(journal, "gateway")}])
    elif kind == "security":
        payload.update(vcnId=identifier(journal, "vcn"), ingressSecurityRules=ingress(journal["ownerCIDR"], journal.get("bastionCIDR")), egressSecurityRules=EGRESS)
    elif kind == "nsg":
        payload.update(vcnId=identifier(journal, "vcn"))  # Empty NSG; explicit SL is the sole permission source.
    elif kind == "subnet":
        payload.update(vcnId=identifier(journal, "vcn"), cidrBlock="10.35.1.0/24", dnsLabel="staging", prohibitPublicIpOnVnic=False,
                       routeTableId=identifier(journal, "routes"), securityListIds=[identifier(journal, "security")])
    elif kind == "bastion":
        payload.update(bastionType="STANDARD", targetSubnetId=identifier(journal, "subnet"), clientCidrList=[source_cidr(journal["ownerCIDR"])], maxSessionTtl=10800)
    elif kind == "instance":
        if not isinstance(public_key, str) or not re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]{68}(?: [^\r\n]{1,100})?", public_key):
            raise KeySafetyError("Verified Ed25519 PUBLIC key required; no launch.")
        if not isinstance(image, str) or not image.startswith("ocid1.image.oc1.uk-london-1."):
            raise KeySafetyError("London official ARM image required.")
        payload.update(availabilityDomain=ad, shape=SHAPE, shapeConfig={"ocpus": 2, "memoryInGBs": 12},
                       imageId=ocid(image, "image"), bootVolumeSizeInGbs=50, assignPublicIp=True, assignIpv6Ip=False,
                       subnetId=identifier(journal, "subnet"), nsgIds=[identifier(journal, "nsg")],
                       instanceOptions={"areLegacyImdsEndpointsDisabled": True}, metadata={"ssh_authorized_keys": public_key})
        payload["launchOptions"] = {"isPvEncryptionInTransitEnabled": True}
    elif kind == "volume":
        payload.update(availabilityDomain=ad, sizeInGbs=100, vpusPerGb=10, isAutoTuneEnabled=False)
    return payload


def cli_arguments(kind, operation, *, payload=None, journal=None, child=None, resource_id=None):
    if kind not in KINDS or operation not in ("create", "get", "list"):
        raise KeySafetyError("Unsupported infrastructure operation.")
    prefix, selector, ocid_kind, _ = KINDS[kind]
    verb = "launch" if kind == "instance" and operation == "create" else operation
    args = [*prefix.split(), verb]
    if operation == "create":
        if not isinstance(payload, dict) or not payload:
            raise KeySafetyError("Fixed specification required.")
        for key, value in payload.items():
            option = "--" + re.sub(r"[A-Z]", lambda match: "-" + match[0].lower(), key)
            args += [option, json.dumps(value, separators=(",", ":")) if not isinstance(value, str) else value]
    elif operation == "get":
        args += ["--" + selector, ocid(resource_id, ocid_kind)]
    else:
        args += ["--compartment-id", ocid(child, "compartment"), "--all"]
        if kind in ("gateway", "routes", "security", "nsg", "subnet"):
            args += ["--vcn-id", identifier(journal, "vcn")]
    return args


def invoke(args):
    ensure_session()
    result = subprocess.run(command(args), capture_output=True, text=True, timeout=call_timeout(), env=clean_environment(), check=False)
    if result.returncode:
        error = OciError.from_stderr("infrastructure-" + args[2], result.stderr)
        if error.status == 400 and args[:3] in (["compute", "instance", "update"], ["compute", "volume-attachment", "attach-paravirtualized-volume"]):
            error.detail = service_error_detail(result.stderr, error)
        # Only exact Compute capacity rejection permits launch backoff. Never
        # retain the raw message or generalize other500s into capacity failures.
        error.capacity = bool(args[:3] == ["compute", "instance", "launch"] and error.status == 500
                              and error.code == "InternalError" and re.search(r'"message"\s*:\s*"Out of host capacity\.?"', result.stderr, re.I))
        raise error
    try:
        if len(result.stdout) > 2_000_000:
            raise ValueError()
        if result.stdout == "" and "--all" in args:
            return []
        envelope = json.loads(result.stdout)
        # Pinned OCI CLI's full empty Object Storage listing omits data and
        # emits only prefixes:[]. This is not a generic missing-data fallback:
        # require the exact unfiltered --all command/envelope. The caller also
        # independently checks full bucket GET count/size/versioning.
        if (len(args) == 8 and args[:3] == ["os", "object", "list"]
                and args[3] == "--namespace-name" and args[5] == "--bucket-name"
                and args[7] == "--all" and envelope == {"prefixes": []}):
            return []
        data = envelope["data"]
        if not isinstance(data, (dict, list)):
            raise ValueError()
        return data
    except (ValueError, KeyError, TypeError):
        raise KeySafetyError("Incomplete infrastructure response; preserve intent, never recreate blindly.") from None


def canonical(value):
    if isinstance(value, dict):
        return {key.replace("-", "").lower(): canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def contains(actual, expected):
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(key in actual and contains(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(contains(a, b) for a, b in zip(actual, expected))
    return actual == expected


def verify(kind, entry, result):
    payload = entry["spec"]
    state = result.get("lifecycle-state")
    identity = {key: payload[key] for key in ("compartmentId", "freeformTags", "name" if kind == "bastion" else "displayName")}
    if not contains(canonical(result), canonical(identity)):
        raise KeySafetyError("Infrastructure identity mismatch: " + kind)
    if state in ("PROVISIONING", "CREATING", "UPDATING", "STARTING"):
        return None
    expected = dict(payload)
    if kind == "vcn":
        expected.pop("isIpv6Enabled")
        if result.get("ipv6-cidr-blocks") or result.get("ipv6-private-cidr-blocks") or result.get("byoipv6-cidr-blocks"):
            raise KeySafetyError("Unexpected IPv6 allocation; no further create.")
    if kind == "bastion":
        expected["clientCidrBlockAllowList"] = expected.pop("clientCidrList")
        expected["maxSessionTtlInSeconds"] = expected.pop("maxSessionTtl")
    # CLI convenience launch parameters are independently checked on VNIC/boot.
    if kind == "instance":
        for key in ("bootVolumeSizeInGbs", "assignPublicIp", "assignIpv6Ip", "subnetId", "nsgIds"):
            expected.pop(key)
    if not contains(canonical(result), canonical(expected)):
        raise KeySafetyError("Infrastructure read-back differs from fixed spec: " + kind + "; raw values suppressed.")
    if state != KINDS[kind][3]:
        raise KeySafetyError("Unexpected lifecycle for " + kind + "; no further create.")
    return ocid(result.get("id"), KINDS[kind][2])


def recorder(journal, entry):
    def record(event):
        entry.setdefault("visibility", []).append(event)
        atomic_metadata(JOURNAL, journal)
    return record


def matches(kind, journal, child):
    rows = invoke(cli_arguments(kind, "list", journal=journal, child=child))
    if not isinstance(rows, list):
        raise KeySafetyError("Incomplete resource list; no create.")
    key = "name" if kind == "bastion" else "display-name"
    candidates = [row for row in rows if row.get(key) == "ir35-staging-" + kind and row.get("lifecycle-state") not in ("DELETED", "TERMINATED")]
    tags = {"ir35-phase": "P1", "ir35-intent": journal["intent"]}
    if len(candidates) > 1 or any(row.get("freeform-tags") != tags or row.get("compartment-id") != child for row in candidates):
        raise KeySafetyError("Name/tag collision: " + kind + "; never create twice or adopt unrelated resources.")
    return candidates


def create_one(kind, journal, child, payload, eligibility):
    existing = journal["created"].get(kind)
    pending = journal.get("pending")
    if pending and pending["kind"] != kind:
        raise KeySafetyError("Reconcile pending infrastructure before any other create.")
    entry = existing or pending
    found = [] if entry else matches(kind, journal, child)
    if entry:
        if entry["spec"] != payload:
            raise KeySafetyError("Recorded intent/spec changed; no create.")
    else:
        entry = {"kind": kind, "spec": payload}
        if found:
            entry["id"] = found[0]["id"]
            entry["reusedByNameAndTags"] = True
        else:
            entry["eligibility"] = eligibility()
        journal["pending"] = entry
        atomic_metadata(JOURNAL, journal)
        if not found:
            print("CREATE CHECK: " + kind + "; London Always Free/no-charge resource; A1 2OCPU/12GB; boot50+block100<=150GB; no production.", flush=True)
            response = invoke(cli_arguments(kind, "create", payload=payload))
            entry["id"] = ocid(response.get("id"), KINDS[kind][2])
            atomic_metadata(JOURNAL, journal)
    def read():
        found = matches(kind, journal, child)
        resource_id = entry.get("id")
        if found:
            if resource_id and resource_id != found[0]["id"]:
                raise KeySafetyError("Name lookup and journal identity disagree.")
            resource_id = found[0]["id"]
        if not resource_id:
            return None
        response = invoke(cli_arguments(kind, "get", resource_id=resource_id))
        if response.get("id") != resource_id:
            raise KeySafetyError("Independent GET identity differs from requested resource.")
        return verify(kind, entry, response)
    result = wait_for_visible(read, label=kind, record=recorder(journal, entry))
    journal["created"][kind] = {**entry, "id": result, "verifiedAt": datetime.now(timezone.utc).isoformat()}
    journal["pending"] = None
    atomic_metadata(JOURNAL, journal)
    print("PASS: " + kind + " independently read back; OCID=" + result, flush=True)
    return result


def owner_cidr():
    observed = []
    for url in ("https://api.ipify.org", "https://checkip.amazonaws.com"):
        with urllib.request.urlopen(url, timeout=15) as response:
            observed.append(source_cidr(response.read(80).decode().strip() + "/32"))
    if observed[0] != observed[1]:
        raise KeySafetyError("Owner public IPv4 sources disagree; no network create.")
    return observed[0]


def fresh_eligibility(client, journal, ad, *, exact_storage=None):
    report = inventory(client, session_account_audit(client), **({'exact_storage': exact_storage} if exact_storage is not None else {}))
    usage = report["usage"]
    has_vm = "instance" in journal["created"]
    has_block = "volume" in journal["created"]
    if (usage["instances"] != int(has_vm) or number(usage["a1Ocpus"]) != (2 if has_vm else 0)
            or number(usage["a1MemoryGB"]) != (12 if has_vm else 0)
            or number(usage["liveVolumeGB"]) != (50 * int(has_vm) + 100 * int(has_block))):
        raise KeySafetyError("Tenancy allocations differ from recorded single-VM envelope; no create.")
    storage = reconcile(report, add_live_gb=str(150 - number(usage["liveVolumeGB"])))
    shapes = [row for row in client.read("shapes", ad=ad) if row.get("shape") == SHAPE]
    if len(shapes) != 1 or shapes[0].get("billing-type") not in ("LIMITED_FREE", "ALWAYS_FREE"):
        raise KeySafetyError("Current A1 free shape label missing; no create.")
    return {"checkedAt": report["checkedAt"], "account": "ACTIVE Free Trial / London home", "shapeBilling": shapes[0]["billing-type"],
            "usage": usage, "storage": storage, "costReport": report["costReport"],
            "freeReference": "https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm"}


def main():
    if sys.argv[1:] != ["provision"]:
        raise KeySafetyError("Fixed provision command only; no production/app deployment.")
    try:
        receipt = json.loads(private_file(control.PREFLIGHT_RECEIPT))
        if (receipt.get("status") != "PASS" or receipt.get("auth") != "security_token" or receipt.get("group") != "limits quota"
                or not 0 <= time.time() - receipt["checkedAt"] <= 1800
                or receipt.get("infrastructureSHA256") != hashlib.sha256(Path(__file__).read_bytes()).hexdigest()):
            raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        raise KeySafetyError("Missing/stale/source-mismatched actual CLI parser proof; no infrastructure create.") from None
    os.umask(0o077)
    private_directory(KEY_DIRECTORY)
    lock = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        control_journal = json.loads(private_file(control.JOURNAL))
        if control_journal.get("pending") or "effectiveReadback" not in control_journal["created"].get("quota", {}):
            raise KeySafetyError("Root quota must be independently verified and effective before infrastructure.")
        client = ReadOnlyOci(ensure_session())
        child = control_journal["created"]["compartment"]["id"]
        client.compartments.add(child)
        control.create_one("compartment", control_journal, client)
        control.create_one("quota", control_journal, client)
        control.wait_for_quota(control_journal, client)
        current_ip = owner_cidr()
        if JOURNAL.exists():
            journal = json.loads(private_file(JOURNAL))
            if journal.get("version") != 1 or journal.get("ownerCIDR") != current_ip:
                raise KeySafetyError("Journal/owner IP changed; no silent ingress widening or state reset.")
        else:
            journal = {"version": 1, "intent": str(uuid.uuid4()), "ownerCIDR": current_ip, "created": {}, "pending": None}
            write_new(JOURNAL, json.dumps(journal).encode())
        ad = control_journal["selectedAD"]
        gate = lambda: fresh_eligibility(client, journal, ad)
        for kind in ("vcn", "gateway", "routes", "security", "nsg", "subnet", "bastion"):
            create_one(kind, journal, child, specification(kind, journal, child, ad), gate)
        # VM launch is deliberately below Bastion/private ingress reconciliation.
        print("Network/Bastion readbacks PASS; VM launch awaits exact private endpoint ingress validation.", flush=True)
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: infrastructure operation failed; raw output suppressed, durable intent retained. No retry.", file=sys.stderr)
        raise SystemExit(1)
