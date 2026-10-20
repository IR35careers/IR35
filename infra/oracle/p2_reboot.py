#!/usr/bin/env python3
"""Single, journalled empty-staging reboot; never reissues an ambiguous action."""
import fcntl
import json
import os
from pathlib import Path
import sys

from bootstrap_audit import KEY_DIRECTORY
import host_ssh
from key_ceremony import KeySafetyError
import p1_infrastructure as infra
from p1_compute import verify_network
from p2_harden import STATE
from security_session import atomic_metadata, private_file
from visibility import wait_for_visible

BOOT = "import json\nfrom pathlib import Path\nprint(json.dumps({'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip()}))\n"


def main():
    if sys.argv[1:] != ["recover-persistent-firewall"]:
        raise KeySafetyError("Fixed staging firewall reboot only")
    descriptor = os.open(KEY_DIRECTORY / "p1-control-plane.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(private_file(STATE))
        journal = json.loads(private_file(infra.JOURNAL))
        if state["stages"]["configure"]["status"] != "PASS" or not journal.get("resourceProvisioningComplete"):
            raise KeySafetyError("Completed empty-staging configuration/P1 required")
        verify_network(journal)
        identifier = infra.identifier(journal, "instance")
        observed = infra.invoke(infra.cli_arguments("instance", "get", resource_id=identifier))
        infra.verify("instance", journal["created"]["instance"], observed)
        entry = state.setdefault("firewallRecoveryReboot", {"requested": False,
            "previousBootId": journal["dataMountIntent"]["rebootVerified"]["bootId"]})
        if not entry["requested"]:
            entry["requested"] = True
            atomic_metadata(STATE, state)
            infra.invoke(["compute", "instance", "action", "--instance-id", identifier, "--action", "SOFTRESET"])
        def read():
            observed = infra.invoke(infra.cli_arguments("instance", "get", resource_id=identifier))
            if observed.get("lifecycle-state") != "RUNNING":
                return None
            infra.verify("instance", journal["created"]["instance"], observed)
            try:
                result = host_ssh.run_remote(BOOT, [], timeout=20)
            except host_ssh.SshNotReady:
                return None
            if result.get("bootId") == entry["previousBootId"]:
                return None
            return result
        def record(event):
            entry.setdefault("visibility", []).append(event)
            atomic_metadata(STATE, state)
        result = wait_for_visible(read, label="p2-firewall-reboot", record=record)
        entry.update(verified=True, bootId=result["bootId"])
        atomic_metadata(STATE, state)
        print("PASS: one staging reboot completed; bootID changed and pinned fresh SSH works; no IAM or broader ingress")
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        main()
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: staging reboot helper failed; action intent retained, no repeat", file=sys.stderr)
        raise SystemExit(1)
