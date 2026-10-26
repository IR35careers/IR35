#!/usr/bin/env python3
"""WSL per-boot SSH agent. Private key remains encrypted, never read here."""
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import signal
import subprocess
import sys
import time

from bootstrap_audit import KEY_DIRECTORY
from key_ceremony import KeySafetyError, private_directory, write_new
from security_session import private_file


def boot_directory():
    boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    if not re.fullmatch(r"[a-f0-9-]{36}", boot):
        raise KeySafetyError("Cannot identify the current WSL boot; no agent/prompt.")
    parent = Path.home() / ".ir35"
    private_directory(parent)
    directory = parent / ("ssh-agent-" + boot)
    if not directory.exists():
        directory.mkdir(mode=0o700)
    private_directory(directory)
    return directory


def expected_fingerprint():
    public = KEY_DIRECTORY / "ssh_ed25519.pub"
    private_file(public)
    result = subprocess.run(["ssh-keygen", "-l", "-f", str(public)], capture_output=True, text=True, timeout=5, check=False)
    match = re.search(r"^256 (SHA256:[A-Za-z0-9+/]{43}) .*\(ED25519\)$", result.stdout.strip())
    if result.returncode or not match:
        raise KeySafetyError("Existing Ed25519 public fingerprint could not be verified.")
    return match[1]


def ensure_agent(*, load=False, owner_retry=False, owner_four_hour=False, owner_four_hour_reopen=False, owner_ready_four_hour=False, owner_migration=False):
    if type(owner_retry)is not bool or owner_retry and not load:
        raise KeySafetyError("Owner retry requires an explicit native load operation.")
    if type(owner_four_hour) is not bool or owner_four_hour and (not load or owner_retry):
        raise KeySafetyError('Four-hour owner unlock requires its single explicit native operation.')
    if type(owner_four_hour_reopen) is not bool or owner_four_hour_reopen and (not load or owner_retry or owner_four_hour):
        raise KeySafetyError('Owner-approved fresh four-hour lease must be its single separate native operation.')
    if type(owner_ready_four_hour) is not bool or owner_ready_four_hour and (not load or owner_retry or owner_four_hour or owner_four_hour_reopen):
        raise KeySafetyError('Ready handoff requires its one explicitly approved native operation.')
    if type(owner_migration) is not bool or owner_migration and (not load or owner_retry or owner_four_hour or owner_four_hour_reopen or owner_ready_four_hour):
        raise KeySafetyError('Migration unlock requires its one plain native operation.')
    directory = boot_directory()
    descriptor = os.open(directory / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        socket = directory / "agent.sock"
        state = directory / "agent.json"
        if not state.exists():
            if socket.exists() or socket.is_symlink():
                raise KeySafetyError("Unreconciled agent socket; stop, do not replace a running agent.")
            result = subprocess.run(["ssh-agent", "-a", str(socket), "-s"], capture_output=True, text=True, timeout=10, check=False)
            match = re.search(r"SSH_AGENT_PID=(\d+);", result.stdout)
            if result.returncode or not match:
                raise KeySafetyError("SSH agent start failed; raw output suppressed, no retry.")
            write_new(state, json.dumps({"pid": int(match[1])}).encode())
        private_file(state)
        info = socket.lstat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise KeySafetyError("SSH agent socket must be owner-only mode600.")
        environment = {key: value for key, value in os.environ.items() if key not in ("SSH_ASKPASS", "SSH_ASKPASS_REQUIRE", "SSH_AUTH_SOCK", "SSH_AGENT_PID")}
        environment["SSH_AUTH_SOCK"] = str(socket)
        result = subprocess.run(["ssh-add", "-l"], capture_output=True, text=True, env=environment, timeout=5, check=False)
        fingerprint = expected_fingerprint()
        loaded = result.returncode == 0 and any(len(line.split()) >= 2 and line.split()[1] == fingerprint for line in result.stdout.splitlines())
        if result.returncode not in (0, 1):
            raise KeySafetyError("Existing agent is unreachable; no restart or repeated passphrase prompt.")
        migration_receipt = directory / 'load-owner-migration-20261026-result.json'
        if load and not loaded and migration_receipt.exists():
            raise KeySafetyError('MigrationIdentityUnloadedInSameAgent_NoAutomaticReprompt')
        if load and (not loaded or owner_four_hour or owner_four_hour_reopen or owner_ready_four_hour):
            if not sys.stdin.isatty() or not sys.stdout.isatty():
                raise KeySafetyError("SSH key loading needs the native terminal's hidden prompt, never chat/pipes.")
            attempt = directory / "load-attempt.json"
            if owner_migration:
                attempt = directory / 'load-owner-migration-20261026.json'
            if owner_four_hour:
                # A separately approved single prompt; never reset previous
                # prompt journals or silently extend an existing identity.
                attempt = directory / 'load-owner-four-hour-20261025.json'
            if owner_four_hour_reopen:
                previous = json.loads(private_file(directory / 'load-owner-four-hour-20261025-result.json'))
                if (previous.get('fingerprint') != fingerprint or previous.get('lifetimeSeconds') != 14400
                        or previous.get('expiresAt', float('inf')) > time.time()):
                    raise KeySafetyError('PreviousFourHourLeaseMustBeVerifiedExpired_NoExtraPrompt')
                # 25 October owner explicitly approved ONE new lease. Keep the
                # earlier attempt/result immutable; no generic reset/retry flag.
                attempt = directory / 'load-owner-four-hour-reopen-20261025.json'
            if owner_ready_four_hour:
                previous = json.loads(private_file(directory / 'load-owner-four-hour-reopen-20261025-result.json'))
                if (previous.get('fingerprint') != fingerprint or previous.get('lifetimeSeconds') != 14400
                        or previous.get('expiresAt', float('inf')) > time.time()):
                    raise KeySafetyError('PreviousFourHourLeaseMustBeVerifiedExpired_NoExtraPrompt')
                # Owner replied Ready—open both once. Preserve both earlier
                # leases; this distinct exclusive slot cannot be retried.
                attempt = directory / 'load-owner-ready-four-hour-20261025.json'
            if owner_retry:
                # 24 October owner replied "retry" to the failed SSH handoff.
                # Keep the first journal; this is one separately recorded slot,
                # never an automatic fallback or a reset of per-boot history.
                if not attempt.exists():
                    raise KeySafetyError("Owner retry requires the retained first attempt.")
                attempt = directory / "load-owner-retry-1.json"
            if attempt.exists():
                raise KeySafetyError("SSH passphrase already requested this boot; no repeat prompt.")
            started = time.time()
            monotonic_started = time.monotonic()
            write_new(attempt, json.dumps({'promptAttempted': True, 'fourHourOwnerApproval': owner_four_hour,
                                          'freshLeaseOwnerApproval': owner_four_hour_reopen,
                                          'readyHandoffOwnerApproval': owner_ready_four_hour,
                                          'plainMigrationOwnerApproval': owner_migration}).encode())
            # ssh-add owns native hidden input. Never obtain/pass/store the passphrase.
            arguments = ['ssh-add', '-t', '4h', str(KEY_DIRECTORY / 'ssh_ed25519')] if owner_four_hour or owner_four_hour_reopen or owner_ready_four_hour else ['ssh-add', str(KEY_DIRECTORY / 'ssh_ed25519')]
            result = subprocess.run(arguments, env=environment, timeout=300, check=False)
            if result.returncode:
                raise KeySafetyError("SSH key was not loaded; no repeat prompt this boot.")
            result = subprocess.run(["ssh-add", "-l"], capture_output=True, text=True, env=environment, timeout=5, check=False)
            loaded = result.returncode == 0 and any(len(line.split()) >= 2 and line.split()[1] == fingerprint for line in result.stdout.splitlines())
            if not loaded:
                raise KeySafetyError("Agent fingerprint verification failed; do not repeat the prompt.")
            if owner_migration:
                write_new(migration_receipt, json.dumps({'keyLoaded': True, 'fingerprint': fingerprint,
                    'mode': 'until-agent-restart', 'agentPID': json.loads(private_file(state))['pid']}).encode())
            if owner_four_hour or owner_four_hour_reopen or owner_ready_four_hour:
                # Conservative deadline starts BEFORE the prompt, never later
                # than ssh-add's real expiry. Metadata only, no private key.
                receipt = 'load-owner-four-hour-reopen-20261025-result.json' if owner_four_hour_reopen else 'load-owner-four-hour-20261025-result.json'
                if owner_ready_four_hour:
                    receipt = 'load-owner-ready-four-hour-20261025-result.json'
                write_new(directory / receipt, json.dumps({
                    'keyLoaded': True, 'fingerprint': fingerprint, 'lifetimeSeconds': 14400,
                    'expiresAt': started + 14400, 'monotonicExpiresAt': monotonic_started + 14400}).encode())
        answer = {"agentReady": True, "keyLoaded": loaded, "socket": str(socket)}
        if loaded:
            answer['keyFingerprint'] = fingerprint
        if loaded and migration_receipt.exists():
            metadata = json.loads(private_file(migration_receipt))
            if (metadata.get('fingerprint') != fingerprint or metadata.get('mode') != 'until-agent-restart'
                    or metadata.get('agentPID') != json.loads(private_file(state))['pid']):
                raise KeySafetyError('MigrationAgentOrFingerprintReceiptMismatch')
            answer['keyLeaseMode'] = 'until-agent-restart'
            return answer
        lease = directory / 'load-owner-four-hour-20261025-result.json'
        renewed = directory / 'load-owner-four-hour-reopen-20261025-result.json'
        if renewed.exists():
            lease = renewed
        ready_lease = directory / 'load-owner-ready-four-hour-20261025-result.json'
        if ready_lease.exists():
            lease = ready_lease
        if loaded and lease.exists():
            metadata = json.loads(private_file(lease))
            if metadata.get('fingerprint') != fingerprint or metadata.get('lifetimeSeconds') != 14400:
                raise KeySafetyError('Agent four-hour fingerprint/lifetime receipt mismatch.')
            answer.update(keyFingerprint=fingerprint, keyLifetimeSecondsRemaining=max(0, int(min(
                metadata['expiresAt'] - time.time(), metadata['monotonicExpiresAt'] - time.monotonic()))))
        return answer
    finally:
        os.close(descriptor)


def cli(arguments):
    if arguments not in (["check"], ["load"], ["load-and-hold"], ["load-owner-retry-and-hold"], ['load-owner-four-hour-and-hold'], ['load-owner-four-hour-reopen-and-hold'], ['load-owner-ready-four-hour-and-hold'], ['load-owner-migration-and-hold']):
        raise KeySafetyError("Use check, load, load-and-hold or the explicitly owner-requested retry only.")
    if arguments == ['load-owner-migration-and-hold']:
        result = ensure_agent(load=True, owner_migration=True)
    elif arguments == ['load-owner-ready-four-hour-and-hold']:
        result = ensure_agent(load=True, owner_ready_four_hour=True)
    elif arguments == ['load-owner-four-hour-reopen-and-hold']:
        result = ensure_agent(load=True, owner_four_hour_reopen=True)
    elif arguments == ['load-owner-four-hour-and-hold']:
        result = ensure_agent(load=True, owner_four_hour=True)
    else:
        result = ensure_agent(load=True,owner_retry=True) if arguments == ["load-owner-retry-and-hold"] else ensure_agent(load=arguments != ["check"])
    print(json.dumps({key: value for key, value in result.items() if key != "socket"}), flush=True)
    if arguments in (["load-and-hold"], ["load-owner-retry-and-hold"], ['load-owner-four-hour-and-hold'], ['load-owner-four-hour-reopen-and-hold'], ['load-owner-ready-four-hour-and-hold'], ['load-owner-migration-and-hold']):
        if not result["keyLoaded"]:
            raise KeySafetyError("Cannot hold an unloaded SSH identity.")
        print("SSH loaded. Keep this window open during staging work so WSL does not idle-stop the agent. Close it or press Ctrl+C when finished. No CPU load or VM operation is generated.", flush=True)
        # An active WSL command retains the agent through Windows-only tests.
        # No polling, secret input, passphrase cache/file or Oracle keepalive.
        signal.pause()


if __name__ == "__main__":
    try:
        cli(sys.argv[1:])
    except KeyboardInterrupt:
        print("SSH terminal hold ended. The key remains encrypted on disk; no passphrase was stored.")
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: agent operation failed; raw output suppressed, no retry.", file=sys.stderr)
        raise SystemExit(1)
