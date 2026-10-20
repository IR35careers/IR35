#!/usr/bin/env python3
"""Read-only OCI CLI bootstrap. Existing local key stays in place; no key values printed."""

import configparser
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

from key_ceremony import KeySafetyError, private_directory

CLI = Path.home() / ".ir35/oci/bin/oci"
OLD_CONFIG = Path("/mnt/c/Users/anves/.oci/config")
KEY_DIRECTORY = Path.home() / ".ir35/keys/oracle-migration-20261020"


def ocid(value, kind):
    if not isinstance(value, str) or not re.fullmatch(r"ocid1\." + kind + r"\.oc1\.[a-z0-9-]*\.[a-z0-9]{8,}", value):
        raise KeySafetyError("Invalid local public OCI identifier; no request made.")
    return value


def read_profile(path=OLD_CONFIG):
    if not path.is_file() or path.stat().st_size > 8192:
        raise KeySafetyError("Expected small local OCI configuration is unavailable.")
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(path)
    profile = parser.defaults()
    if profile.get("pass_phrase") or profile.get("region") != "uk-london-1":
        raise KeySafetyError("Refuse stored passphrase or non-London bootstrap configuration.")
    # Map a path only, never copy/read/print the old private key in this helper.
    match = re.fullmatch(r"C:[/\\]Users[/\\]anves[/\\]\.oci[/\\]([A-Za-z0-9_-]+\.pem)", profile.get("key_file", ""))
    if not match or not re.fullmatch(r"(?:[a-f0-9]{2}:){15}[a-f0-9]{2}", profile.get("fingerprint", "")):
        raise KeySafetyError("Unexpected bootstrap key location or fingerprint.")
    mapped_key = OLD_CONFIG.parent / match.group(1)
    if mapped_key.resolve().parent != OLD_CONFIG.parent or not mapped_key.is_file():
        raise KeySafetyError("Expected existing bootstrap key is unavailable.")
    return {
        "tenancy": ocid(profile.get("tenancy"), "tenancy"),
        "user": ocid(profile.get("user"), "user"),
        "fingerprint": profile["fingerprint"], "key_file": str(mapped_key), "region": "uk-london-1",
    }


def prepare_config(profile, filename="bootstrap-config"):
    parent = Path.home() / ".ir35/p1-tooling"
    private_directory(parent)
    if filename not in ("bootstrap-config", "encrypted-api-config") or set(profile) != {"tenancy", "user", "fingerprint", "key_file", "region"}:
        raise KeySafetyError("Unexpected generated profile fields or filename; no write.")
    if any(not isinstance(v, str) or any(c in v for c in ("\n", "\r", "\0")) for v in profile.values()):
        raise KeySafetyError("Invalid generated profile metadata; no write.")
    path = parent / filename
    value = "[DEFAULT]\n" + "".join(k + "=" + v + "\n" for k, v in profile.items())
    # Generated non-secret profile metadata, outside Git. Never store pass_phrase.
    if path.exists() or path.is_symlink():
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
            raise KeySafetyError("Unsafe existing bootstrap metadata file; stopped.")
        if path.read_text() != value:
            raise KeySafetyError("Bootstrap metadata changed; no overwrite or silent key rotation.")
        return path
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(path, 0o600)
    return path


def cli_json(config, arguments, *, public_key_upload=False, passphrase=None):
    profile = read_profile()
    read_commands = [
        ["iam", "tenancy", "get", "--tenancy-id", profile["tenancy"]],
        ["iam", "user", "get", "--user-id", profile["user"]],
        ["iam", "region-subscription", "list", "--tenancy-id", profile["tenancy"], "--all"],
        ["iam", "user", "api-key", "list", "--user-id", profile["user"], "--all"],
        ["organizations", "subscription", "list", "--compartment-id", profile["tenancy"], "--all"],
    ]
    if public_key_upload:
        expected = ["iam", "user", "api-key", "upload", "--user-id", profile["user"],
                    "--key-file", str(KEY_DIRECTORY / "oci_api_public.pem")]
        allowed = arguments == expected
    else:
        allowed = arguments in read_commands
    if not allowed:
        raise KeySafetyError("Command is outside the fixed bootstrap audit/public-key scope.")
    environment = {k: v for k, v in os.environ.items() if not k.startswith("OCI_")}
    if passphrase is not None:
        if public_key_upload or not isinstance(passphrase, str) or not passphrase:
            raise KeySafetyError("Encrypted-key unlock is limited to read-only authentication checks.")
        # Child-process memory only: never config, disk, arguments, stdout or logs.
        environment["OCI_CLI_PASSPHRASE"] = passphrase
    command = [str(CLI), "--config-file", str(config), "--profile", "DEFAULT", "--cli-rc-file", "/dev/null",
               "--region", "uk-london-1", "--no-retry", "--connection-timeout", "5", "--read-timeout", "30",
               "--output", "json", *arguments]
    result = subprocess.run(command, capture_output=True, text=True, env=environment, timeout=65, check=False)
    if result.returncode:
        # OCI errors may include request bodies/URLs. Emit only bounded code/status,
        # never raw stderr/stdout or the subprocess exception/argument array.
        code = re.search(r'"code"\s*:\s*"([A-Za-z][A-Za-z0-9_]{0,63})"', result.stderr)
        status = re.search(r'"status"\s*:\s*(\d{3})', result.stderr)
        message = "OCI call failed: code=" + (code[1] if code else "CLIError") + "; status=" + (status[1] if status else "unknown") + "; no automatic retry."
        if passphrase:
            message = message.replace(passphrase, "[REDACTED]")
        raise KeySafetyError(message)
    if len(result.stdout) > 2_000_000:
        raise KeySafetyError("OCI read returned oversized metadata; stopped.")
    value = json.loads(result.stdout)
    if not isinstance(value, dict) or "data" not in value:
        raise KeySafetyError("OCI read returned unexpected metadata; stopped.")
    return value["data"]


def rows(value):
    if isinstance(value, dict):
        value = value.get("items")
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise KeySafetyError("OCI list returned unexpected metadata; stopped.")
    return value


def audit(profile=None, passphrase=None):
    original = read_profile()
    encrypted = profile is not None
    profile = original if profile is None else profile
    if profile["user"] != original["user"] or profile["tenancy"] != original["tenancy"] or profile["region"] != "uk-london-1":
        raise KeySafetyError("Encrypted profile identity changed; no request.")
    config = prepare_config(profile, "encrypted-api-config" if encrypted else "bootstrap-config")
    def read(arguments):
        return cli_json(config, arguments, passphrase=passphrase)
    tenancy = read(["iam", "tenancy", "get", "--tenancy-id", profile["tenancy"]])
    user = read(["iam", "user", "get", "--user-id", profile["user"]])
    regions = rows(read(["iam", "region-subscription", "list", "--tenancy-id", profile["tenancy"], "--all"]))
    keys = rows(read(["iam", "user", "api-key", "list", "--user-id", profile["user"], "--all"]))
    subscriptions = rows(read(["organizations", "subscription", "list", "--compartment-id", profile["tenancy"], "--all"]))
    if tenancy.get("id") != profile["tenancy"] or str(tenancy.get("name", "")).lower() != "ir35careers":
        raise KeySafetyError("Signed tenancy identity does not match the expected owner account.")
    if user.get("id") != profile["user"] or user.get("lifecycle-state") != "ACTIVE":
        raise KeySafetyError("Signed user identity is not the expected ACTIVE user.")
    if len(regions) != 1 or regions[0].get("region-name") != "uk-london-1" or regions[0].get("is-home-region") is not True or regions[0].get("status") != "READY":
        raise KeySafetyError("Signed account region/home/readiness does not match London.")
    status = json.loads((KEY_DIRECTORY / "status.json").read_text())
    fingerprint = status.get("apiPublicFingerprint")
    if not isinstance(fingerprint, str) or not re.fullmatch(r"(?:[a-f0-9]{2}:){15}[a-f0-9]{2}", fingerprint):
        raise KeySafetyError("New key ceremony fingerprint is invalid.")
    return {
        "checkedAt": datetime.now(timezone.utc).isoformat(), "mode": "read-only-encrypted-api-audit" if encrypted else "read-only-bootstrap-audit",
        "signedTenancyMatch": True, "activeUserMatch": True, "homeRegion": "uk-london-1", "regionStatus": "READY",
        "registeredApiKeys": len(keys), "newPublicKeyRegistered": any(k.get("fingerprint") == fingerprint for k in keys),
        "newPublicKeyState": next((k.get("lifecycle-state") for k in keys if k.get("fingerprint") == fingerprint), "ABSENT"),
        "oldPublicKeyStillRegistered": any(k.get("fingerprint") == original["fingerprint"] for k in keys),
        "subscriptionCount": len(subscriptions),
        "subscriptions": [{
            key: row.get(field) if isinstance(row.get(field), str) and re.fullmatch(r"[A-Z_]{1,40}", row[field]) else "UNVERIFIED"
            for key, field in [("state", "lifecycle-state"), ("paymentModel", "payment-model")]
        } for row in subscriptions],
        "newKeyEncryptedRoundTrip": status.get("encrypted") is True and status.get("roundTripVerified") is True,
        "cloudWrites": 0, "productionChanges": 0,
    }


if __name__ == "__main__":
    try:
        if len(sys.argv) != 1:
            raise KeySafetyError("No arguments accepted for the fixed read-only bootstrap audit.")
        print(json.dumps(audit(), indent=2))
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: bootstrap read failed; raw input/provider output suppressed. No automatic retry.", file=sys.stderr)
        raise SystemExit(1)
