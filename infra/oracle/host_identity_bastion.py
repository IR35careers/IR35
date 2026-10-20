"""Verify guest key over OCI Bastion, pinning the gateway key from signed API."""
import ipaddress
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time

from cryptography.hazmat.primitives import serialization

from bootstrap_audit import KEY_DIRECTORY, ocid
from key_ceremony import KeySafetyError, write_new
import host_identity_repair as repair
import host_ssh
import p1_compute
import p1_infrastructure as infra
from security_session import atomic_metadata, clean_environment, command, ensure_session, private_file
from ssh_agent_session import ensure_agent
from visibility import OciError, wait_for_visible

NAME = "ir35-hostkey-verification"
GATEWAY = "host.bastion.uk-london-1.oci.oraclecloud.com"


def gateway_key(info):
    keys = re.findall(r"(?<![A-Za-z0-9-])((?:ssh-(?:rsa|ed25519)|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/=]+)", info or "")
    if len(set(keys)) != 1:
        raise KeySafetyError("Signed Bastion session must supply exactly one public gateway key; no TOFU.")
    key = keys[0]
    try:
        serialization.load_ssh_public_key(key.encode())
    except ValueError:
        raise KeySafetyError("Invalid signed Bastion gateway public key; no trust bypass.") from None
    return key


def payload(bastion, instance, private_ip, public_key):
    address = ipaddress.IPv4Address(private_ip)
    if address not in ipaddress.IPv4Network("10.35.1.0/24"):
        raise KeySafetyError("Bastion target must be the verified staging subnet address.")
    return {"bastionId": ocid(bastion, "bastion"), "displayName": NAME, "keyType": "PUB",
            "keyDetails": {"publicKeyContent": public_key}, "sessionTtlInSeconds": 1800,
            "targetResourceDetails": {"sessionType": "PORT_FORWARDING", "targetResourceId": ocid(instance, "instance"),
                                      "targetResourcePrivateIpAddress": str(address), "targetResourcePort": 22}}


def create_args(spec):
    # OCI's generic from-json wrapper cannot bind its removed key-details
    # option. Use the documented specialised command and public-key file.
    target = spec["targetResourceDetails"]
    return ["bastion", "session", "create-port-forwarding", "--bastion-id", spec["bastionId"], "--display-name", spec["displayName"],
            "--key-type", "PUB", "--ssh-public-key-file", str(KEY_DIRECTORY / "ssh_ed25519.pub"), "--session-ttl", str(spec["sessionTtlInSeconds"]),
            "--target-resource-id", target["targetResourceId"], "--target-port", "22", "--target-private-ip", target["targetResourcePrivateIpAddress"]]


def verify_session(spec, row):
    # File input retains a final newline; it does not change the public key.
    normalized = json.loads(json.dumps(row))
    content = normalized.get("key-details", {}).get("public-key-content")
    if isinstance(content, str):
        normalized["key-details"]["public-key-content"] = content.strip()
    if not infra.contains(infra.canonical(normalized), infra.canonical(spec)):
        raise KeySafetyError("Bastion session target/key/TTL/parent differs; no connection or deletion.")
    return ocid(row.get("id"), "bastionsession")


def ensure_session_once(state, journal, cp, client):
    instance = state["instanceId"]
    child = cp["created"]["compartment"]["id"]
    attached = infra.invoke(["compute", "vnic-attachment", "list", "--compartment-id", child, "--instance-id", instance, "--all"])
    attached = [row for row in attached if row.get("lifecycle-state") == "ATTACHED" and row.get("instance-id") == instance]
    if len(attached) != 1:
        raise KeySafetyError("Expected one exact staging VNIC before Bastion verification.")
    vnic = infra.invoke(["network", "vnic", "get", "--vnic-id", attached[0]["vnic-id"]])
    if vnic.get("public-ip") != journal["computeReadback"]["publicIP"] or vnic.get("subnet-id") != infra.identifier(journal, "subnet"):
        raise KeySafetyError("Bastion target VNIC identity differs.")
    p1_compute.verify_network(journal)
    bastion = infra.invoke(infra.cli_arguments("bastion", "get", resource_id=infra.identifier(journal, "bastion")))
    infra.verify("bastion", journal["created"]["bastion"], bastion)
    if (infra.owner_cidr() != journal["ownerCIDR"] or bastion.get("client-cidr-block-allow-list") != [journal["ownerCIDR"]]
            or bastion.get("private-endpoint-ip-address", "") + "/32" != journal["bastionCIDR"]):
        raise KeySafetyError("Owner/Bastion exact SSH sources changed; no network widening.")
    public_key = private_file(KEY_DIRECTORY / "ssh_ed25519.pub").strip()
    spec = payload(bastion["id"], instance, vnic["private-ip"], public_key)
    entry = state.setdefault("bastionVerification", {})
    listed = infra.invoke(["bastion", "session", "list", "--bastion-id", bastion["id"], "--all"])
    found = [row for row in listed if row.get("display-name") == NAME and row.get("lifecycle-state") != "DELETED"]
    if len(found) > 1:
        raise KeySafetyError("Duplicate Bastion verification session; no create.")
    if found:
        # SessionSummary need not carry full key details; verify a full GET.
        identifier = ocid(found[0].get("id"), "bastionsession")
        verify_session(spec, infra.invoke(["bastion", "session", "get", "--session-id", identifier]))
        if entry.get("id") not in (None, identifier):
            raise KeySafetyError("Bastion verification identity changed.")
        entry["id"] = identifier
    elif not entry.get("createRequested"):
        entry["eligibility"] = infra.fresh_eligibility(client, journal, journal["created"]["instance"]["spec"]["availabilityDomain"])
        entry["createRequested"] = True
        atomic_metadata(repair.STATE, state)
        print("CREATE CHECK: free Bastion port-forward session to same stagingVM22 only, TTL1800, ownerIP/32; no network/IAM/production change. 2/12/150 caps rechecked.", flush=True)
        created = infra.invoke(create_args(spec))
        entry["id"] = ocid(created.get("id"), "bastionsession")
        atomic_metadata(repair.STATE, state)
        verify_session(spec, created)
    if not entry.get("id"):
        raise KeySafetyError("Ambiguous Bastion session create; never submit twice.")
    def active():
        row = infra.invoke(["bastion", "session", "get", "--session-id", entry["id"]])
        if verify_session(spec, row) != entry["id"]:
            raise KeySafetyError("Bastion session GET identity differs.")
        if row.get("lifecycle-state") == "CREATING":
            return None
        if row.get("lifecycle-state") != "ACTIVE":
            raise KeySafetyError("Bastion session did not become ACTIVE.")
        return row
    row = wait_for_visible(active, label="bastion-hostkey-verification")
    metadata = json.dumps(row.get("ssh-metadata", {}))
    if GATEWAY not in metadata:
        raise KeySafetyError("Signed session has an unexpected gateway; no connection.")
    return spec, row


def ssh_options(agent, known_hosts, alias, *, public_scan_bootstrap=False):
    return ["BatchMode=yes", "IdentitiesOnly=yes", "StrictHostKeyChecking=" + ("accept-new" if public_scan_bootstrap else "yes"), "PasswordAuthentication=no", "KbdInteractiveAuthentication=no",
            "ForwardAgent=no", "ClearAllForwardings=no", "ConnectTimeout=10", "ServerAliveInterval=10", "ServerAliveCountMax=2",
            "ExitOnForwardFailure=yes", "UserKnownHostsFile=" + str(known_hosts), "GlobalKnownHostsFile=/dev/null",
            "HostKeyAlias=" + alias, "IdentityAgent=" + agent["socket"]]


def scan_through_bastion(state, journal, row, algorithm):
    expected = state.get("console", {}).get("publicFingerprint") or state.get("fallbackPublicFingerprint")
    if not expected or expected.get("algorithm") != algorithm or not re.fullmatch(r"SHA256:[A-Za-z0-9+/]{43}", expected.get("fingerprint", "")):
        raise KeySafetyError("Authenticated guest fingerprint required before any gateway bootstrap.")
    if state.get("fallbackPublicFingerprint") and not all(state.get("temporaryIam", {}).get(kind, {}).get("deleted") for kind in ("policy", "group")):
        raise KeySafetyError("Temporary IAM must be gone before any gateway bootstrap.")
    supplied = row.get("bastion-public-host-key-info")
    public = gateway_key(supplied) if supplied else None
    alias = "ir35-bastion-" + row["id"]
    hosts = KEY_DIRECTORY / ("bastion-host-" + hashlib.sha256(row["id"].encode()).hexdigest()[:24])
    if public:
        line = alias + " " + public + "\n"
        if hosts.exists():
            if private_file(hosts) != line:
                raise KeySafetyError("Signed gateway key differs from pinned session key; no replacement.")
        else:
            write_new(hosts, line.encode())
        trust = "signed-API-public-key"
    else:
        # The outer gateway carries ONLY a public-key scan, never a guest login,
        # command or secrets. Its first-use record is not claimed authenticated.
        # Inner VM identity still MUST match the independently authenticated key.
        if not hosts.exists():
            write_new(hosts, b"")
        else:
            private_file(hosts)
        trust = "first-use-gateway-public-scan-only;not-out-of-band-verified"
        print("INFO: gateway API omits its key; first-use gateway record is limited to public guest keyscan, no guest authentication/secrets. VM fingerprint match remains mandatory.", flush=True)
    state["bastionVerification"]["gatewayTrustMethod"] = trust
    atomic_metadata(repair.STATE, state)
    agent = ensure_agent()
    if not agent["keyLoaded"]:
        raise KeySafetyError("Existing agent key is not loaded; no passphrase retry.")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    private_ip = row["target-resource-details"]["target-resource-private-ip-address"]
    options = ssh_options(agent, hosts, alias, public_scan_bootstrap=public is None)
    args = ["ssh", "-F", "/dev/null", *[value for option in options for value in ("-o", option)], "-i", str(KEY_DIRECTORY / "ssh_ed25519"),
            "-N", "-T", "-L", "127.0.0.1:" + str(port) + ":" + private_ip + ":22", "-p", "22", row["id"] + "@" + GATEWAY]
    environment = {key: value for key, value in os.environ.items() if key not in ("SSH_ASKPASS", "SSH_ASKPASS_REQUIRE")}
    environment["SSH_AUTH_SOCK"] = agent["socket"]
    process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=environment)
    try:
        deadline = time.monotonic() + 15
        while True:
            if process.poll() is not None:
                raise KeySafetyError("Bastion tunnel failed; strict gateway verification retained, raw output suppressed.")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except OSError:
                if time.monotonic() >= deadline:
                    raise KeySafetyError("Bastion local tunnel did not become ready; no retry.")
                time.sleep(0.25)
        scan = subprocess.run(["ssh-keyscan", "-T", "10", "-p", str(port), "-t", algorithm, "127.0.0.1"],
                              capture_output=True, text=True, timeout=15, check=False)
        if scan.returncode:
            raise KeySafetyError("Guest host-key scan over Bastion failed; no public-path substitution.")
        lines = [line for line in scan.stdout.splitlines() if line and not line.startswith("#")]
        if len(lines) != 1:
            raise KeySafetyError("Expected one guest host key over Bastion.")
        return journal["computeReadback"]["publicIP"] + " " + " ".join(lines[0].split()[1:])
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=5)


def remove_session(state, spec):
    entry = state["bastionVerification"]
    get = ["bastion", "session", "get", "--session-id", entry["id"]]
    try:
        row = infra.invoke(get)
    except OciError as error:
        if error.status == 404 and entry.get("deleteRequested"):
            entry["deleted"] = True
            atomic_metadata(repair.STATE, state)
            return
        raise
    verify_session(spec, row)
    if row.get("lifecycle-state") == "DELETED":
        entry["deleted"] = True
        atomic_metadata(repair.STATE, state)
        return
    if not entry.get("deleteRequested"):
        entry["deleteRequested"] = True
        atomic_metadata(repair.STATE, state)
        ensure_session()
        result = subprocess.run(command(["bastion", "session", "delete", "--session-id", entry["id"], "--force"]),
                                capture_output=True, text=True, timeout=65, env=clean_environment(), check=False)
        if result.returncode:
            raise OciError.from_stderr("owned-bastion-session-delete", result.stderr)
    def absent():
        try:
            current = infra.invoke(get)
        except OciError as error:
            if error.status == 404:
                return True
            raise
        verify_session(spec, current)
        return True if current.get("lifecycle-state") == "DELETED" else None
    wait_for_visible(absent, label="bastion-verification-session-deleted")
    entry["deleted"] = True
    atomic_metadata(repair.STATE, state)


def verify_and_pin(state, journal, cp, client):
    fingerprint = state["console"].get("publicFingerprint")
    if not fingerprint:
        if not all(state.get("temporaryIam", {}).get(kind, {}).get("deleted") for kind in ("policy", "group")):
            raise KeySafetyError("Conditional IAM cleanup must PASS before Bastion/SSH enrollment.")
        fingerprint = state.get("fallbackPublicFingerprint")
    if not fingerprint or fingerprint.get("algorithm") not in ("ed25519", "ecdsa"):
        raise KeySafetyError("Verified ED25519/ECDSA public fingerprint required; no key substitution.")
    spec, row = ensure_session_once(state, journal, cp, client)
    try:
        scanned = scan_through_bastion(state, journal, row, fingerprint["algorithm"])
        line, matched = host_ssh.match_host_key(journal["computeReadback"]["publicIP"], scanned, fingerprint["fingerprint"], fingerprint["algorithm"])
    finally:
        remove_session(state, spec)
    if host_ssh.KNOWN_HOSTS.exists():
        if private_file(host_ssh.KNOWN_HOSTS) != line:
            raise KeySafetyError("Existing guest known_hosts differs; no replacement.")
    else:
        write_new(host_ssh.KNOWN_HOSTS, line.encode())
    host = json.loads(private_file(host_ssh.HOST_JOURNAL))
    if host.get("instanceId") != state["instanceId"]:
        raise KeySafetyError("SSH enrollment journal belongs to another instance.")
    host.update(verified=True, fingerprint=matched, knownHostsLine=line,
                source="OCI Run Command" if state.get("fallbackPublicFingerprint") else "OCI console fingerprint block", viaBastion=True)
    atomic_metadata(host_ssh.HOST_JOURNAL, host)
    if journal.get("stop", {}).get("kind") != "sshHostTrust" or journal["stop"].get("code") != "ConsoleFingerprintMissing":
        raise KeySafetyError("Unrelated P1 failure cannot be cleared by host verification.")
    journal.setdefault("hostTrustHistory", []).append(journal["sshHostTrust"])
    journal["sshHostTrust"] = {"status": "PASS", "fingerprint": matched, "viaBastion": True, "temporaryIamDeleted": True,
                               "consoleDeleted": state["console"].get("deleted"), "sshAttempted": False, "formatAttempted": False}
    journal.pop("stop")
    atomic_metadata(infra.JOURNAL, journal)
    state["verifiedFingerprint"] = matched
    atomic_metadata(repair.STATE, state)
    print("PASS: guest fingerprint matches authenticated source over Bastion; gateway method recorded separately, temporary IAM absent/session removed; fingerprint=" + matched, flush=True)


def reconcile_public_key_newline(state, journal, cp, client):
    entry = state.get("bastionVerification", {})
    if (state.get("halted") != {"code": "HostRepairCheckFailed", "status": None}
            or not entry.get("createRequested") or entry.get("id")
            or not state.get("fallbackPublicFingerprint")
            or not all(state.get("temporaryIam", {}).get(kind, {}).get("deleted") for kind in ("policy", "group"))):
        raise KeySafetyError("Only the diagnosed first public-key newline assertion may reconcile; no general failure reset.")
    spec, row = ensure_session_once(state, journal, cp, client)
    actual = row.get("key-details", {}).get("public-key-content")
    desired = spec["keyDetails"]["publicKeyContent"]
    if not isinstance(actual, str) or actual == desired or actual.strip() != desired:
        raise KeySafetyError("Observed difference is not exactly public-key edge whitespace; hold remains.")
    state["publicKeyNewlineRepair"] = {"priorHalt": state.pop("halted"), "fullGetVerified": True, "newSessionCreated": False}
    atomic_metadata(repair.STATE, state)
    print("PASS: reconciled existing Bastion session; only trailing public-key newline differed, no second create.", flush=True)
    verify_and_pin(state, journal, cp, client)
