"""Agent-only SSH with a host key matched to authenticated OCI console history."""
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import subprocess

from bootstrap_audit import KEY_DIRECTORY, ocid
from key_ceremony import KeySafetyError, write_new
import p1_infrastructure as infra
from security_session import atomic_metadata, clean_environment, command, ensure_session, private_file
from ssh_agent_session import ensure_agent
from visibility import OciError, wait_for_visible, call_timeout

HOST_JOURNAL = KEY_DIRECTORY / "p1-ssh-hostkey.json"
KNOWN_HOSTS = KEY_DIRECTORY / "oracle-staging-known-hosts"


class SshNotReady(KeySafetyError):
    """Connection transport only; authentication/key errors are never transient."""


def connection_not_ready(code, stderr):
    if code != 255 or re.search(r"(?i)permission denied|host key verification failed|identification has changed|no .*host key is known", stderr):
        return False
    return bool(re.search(r"(?i)connection refused|connection timed out|connection reset|connection closed by|no route to host", stderr))


def match_host_key(ip, keyscan, console, algorithm="ed25519"):
    console_fingerprints = re.findall(r"SHA256:[A-Za-z0-9+/]{43}", console)
    if not console_fingerprints:
        raise KeySafetyError("Oracle console snapshot contains no SHA256 host fingerprint; SSH identity is unverified, not a proven changed key. No trust bypass.")
    rows = [line for line in keyscan.splitlines() if line and not line.startswith("#")]
    key_pattern = {"ed25519": r"ssh-ed25519 [A-Za-z0-9+/=]{68}",
                   "ecdsa": r"ecdsa-sha2-nistp(?:256|384|521) [A-Za-z0-9+/=]{80,512}"}.get(algorithm)
    if not key_pattern or len(rows) != 1 or not re.fullmatch(re.escape(ip) + " " + key_pattern, rows[0]):
        raise KeySafetyError("Expected one exact public-IP supported host key; no host trust enrolled.")
    result = subprocess.run(["ssh-keygen", "-lf", "-", "-E", "sha256"], input=rows[0] + "\n", capture_output=True, text=True, timeout=5, check=False)
    match = re.search(r"SHA256:[A-Za-z0-9+/]{43}(?=\s|$)", result.stdout)
    if result.returncode or not match or match[0] not in console_fingerprints:
        raise KeySafetyError("SSH host key did not match authenticated OCI console fingerprint; no trust bypass.")
    return rows[0] + "\n", match[0]


def enroll(journal, cp, client):
    ip = str(ipaddress.IPv4Address(journal["computeReadback"]["publicIP"]))
    if not ipaddress.ip_address(ip).is_global:
        raise KeySafetyError("Expected recorded public OCI VM IPv4.")
    if HOST_JOURNAL.exists():
        state = json.loads(private_file(HOST_JOURNAL))
        if state.get("publicIP") != ip or state.get("instanceId") != infra.identifier(journal, "instance"):
            raise KeySafetyError("SSH enrollment identity changed; no key replacement.")
    else:
        state = {"publicIP": ip, "instanceId": infra.identifier(journal, "instance"), "capturePending": False}
        write_new(HOST_JOURNAL, json.dumps(state).encode())
    if state.get("verified"):
        if private_file(KNOWN_HOSTS) != state["knownHostsLine"]:
            raise KeySafetyError("Pinned SSH host key file changed; no replacement.")
        return state
    tags = {"ir35-phase": "P1", "ir35-intent": journal["intent"], "ir35-purpose": "ssh-hostkey"}
    child = cp["created"]["compartment"]["id"]
    listed = infra.invoke(["compute", "console-history", "list", "--compartment-id", child, "--instance-id", state["instanceId"], "--all"])
    found = [row for row in listed if row.get("display-name") == "ir35-ssh-hostkey-bootstrap"]
    if len(found) > 1 or any(row.get("freeform-tags") != tags or row.get("instance-id") != state["instanceId"] for row in found):
        raise KeySafetyError("Console snapshot name/tag collision; no duplicate capture.")
    if found:
        state["consoleHistoryId"] = ocid(found[0].get("id"), "consolehistory")
    elif not state.get("capturePending"):
        state["eligibility"] = infra.fresh_eligibility(client, journal, journal["created"]["instance"]["spec"]["availabilityDomain"])
        state["capturePending"] = True
        atomic_metadata(HOST_JOURNAL, state)
        print("CAPTURE CHECK: diagnostics of same Always Free A1; no added compute/volume/service or production change. Raw console stays in RAM only.", flush=True)
        result = infra.invoke(["compute", "console-history", "capture", "--instance-id", state["instanceId"],
                               "--display-name", "ir35-ssh-hostkey-bootstrap", "--freeform-tags", json.dumps(tags)])
        state["consoleHistoryId"] = ocid(result.get("id"), "consolehistory")
        atomic_metadata(HOST_JOURNAL, state)
    if not state.get("consoleHistoryId"):
        raise KeySafetyError("Ambiguous console capture; reconcile, never recapture blindly.")
    def ready():
        result = infra.invoke(["compute", "console-history", "get", "--instance-console-history-id", state["consoleHistoryId"]])
        if result.get("instance-id") != state["instanceId"] or result.get("freeform-tags") != tags:
            raise KeySafetyError("Console snapshot identity mismatch.")
        if result.get("lifecycle-state") in ("REQUESTED", "GETTING-HISTORY"):
            return None
        if result.get("lifecycle-state") != "SUCCEEDED":
            raise KeySafetyError("OCI console snapshot failed; no SSH trust bypass.")
        return True
    def record(event):
        state.setdefault("visibility", []).append(event)
        atomic_metadata(HOST_JOURNAL, state)
    wait_for_visible(ready, label="ssh-console-history", record=record)
    ensure_session()
    # Explicitly read the entire bounded snapshot, not the API's default slice.
    args = ["compute", "console-history", "get-content", "--instance-console-history-id", state["consoleHistoryId"],
            "--file", "-", "--offset", "0", "--length", "1048576"]
    raw = subprocess.run(command(args), capture_output=True, text=True, timeout=65, env=clean_environment(), check=False)
    if raw.returncode:
        raise OciError.from_stderr("console-content", raw.stderr)
    if len(raw.stdout) > 1_100_000:
        raise KeySafetyError("Unexpected console snapshot size; raw data suppressed.")
    scan = subprocess.run(["ssh-keyscan", "-T", "10", "-t", "ed25519", ip], capture_output=True, text=True, timeout=15, check=False)
    if scan.returncode:
        raise KeySafetyError("SSH public-key scan failed; no retry or trust bypass.")
    line, fingerprint = match_host_key(ip, scan.stdout, raw.stdout)
    if KNOWN_HOSTS.exists():
        if private_file(KNOWN_HOSTS) != line:
            raise KeySafetyError("Existing known-hosts record differs; never overwrite a host key.")
    else:
        write_new(KNOWN_HOSTS, line.encode())
    state.update(verified=True, fingerprint=fingerprint, knownHostsLine=line)
    atomic_metadata(HOST_JOURNAL, state)
    print("PASS: SSH Ed25519 host key matches OCI console; fingerprint=" + fingerprint, flush=True)
    return state


def run_remote(source, arguments, *, timeout=65, user="ubuntu"):
    if user not in ("ubuntu", "ir35"):
        raise KeySafetyError("Only approved ubuntu administration or non-root ir35 SSH is permitted.")
    state = json.loads(private_file(HOST_JOURNAL))
    if not state.get("verified") or private_file(KNOWN_HOSTS) != state["knownHostsLine"]:
        raise KeySafetyError("Authenticated SSH host enrollment required.")
    agent = ensure_agent()
    if not agent["keyLoaded"]:
        raise KeySafetyError("Existing SSH key not loaded; no repeated passphrase prompt.")
    options = ["BatchMode=yes", "IdentitiesOnly=yes", "StrictHostKeyChecking=yes", "PasswordAuthentication=no", "KbdInteractiveAuthentication=no",
               "ForwardAgent=no", "ClearAllForwardings=yes", "ConnectTimeout=10", "ServerAliveInterval=10", "ServerAliveCountMax=3",
               "UserKnownHostsFile=" + str(KNOWN_HOSTS), "GlobalKnownHostsFile=/dev/null", "IdentityAgent=" + agent["socket"]]
    remote = (["sudo", "-n"] if user == "ubuntu" else []) + ["/usr/bin/python3", "-u", "-", *arguments]
    args = ["ssh", "-F", "/dev/null", *[item for option in options for item in ("-o", option)], "-i", str(KEY_DIRECTORY / "ssh_ed25519"),
            user + "@" + state["publicIP"], shlex.join(remote)]
    # Source DB/Storage read credentials are local-only, not needed by SSH.
    environment = {key: value for key, value in os.environ.items() if key not in ("SSH_ASKPASS", "SSH_ASKPASS_REQUIRE", "IR35_SOURCE_STORAGE_KEY") and not key.startswith("PG")}
    environment["SSH_AUTH_SOCK"] = agent["socket"]
    result = subprocess.run(args, input=source, capture_output=True, text=True, timeout=call_timeout(timeout), env=environment, check=False)
    if result.returncode:
        if connection_not_ready(result.returncode, result.stderr):
            raise SshNotReady("SSH transport unavailable; only an explicit reboot wait may poll this condition.")
        # Only the controlled remote program's JSON errors are safe to retain.
        try:
            error = json.loads(result.stdout.splitlines()[-1])["error"]
        except (ValueError, IndexError, KeyError):
            error = "SSH/remote command failed; raw output suppressed"
        raise KeySafetyError(str(error))
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise KeySafetyError("Remote result was not bounded structured JSON; raw output suppressed.") from None
