#!/usr/bin/env python3
"""G1 unlock of the existing encrypted key; read-only signed identity proof only."""

import getpass
import json
import os
import resource
import stat
import sys
import warnings

from cryptography.hazmat.primitives import serialization

from bootstrap_audit import KEY_DIRECTORY, audit, read_profile
from key_ceremony import KeySafetyError, private_directory, validate_passphrase, write_new
from register_api_key import check_public_key, require_free_credential_gate


def encrypted_profile(passphrase):
    """Unlock only in memory; reusable by the separately scoped resource audit."""
    fingerprint = check_public_key(KEY_DIRECTORY)
    private_directory(KEY_DIRECTORY)
    path = KEY_DIRECTORY / "oci_api.pem"
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or info.st_size > 16384:
        raise KeySafetyError("Encrypted API key permissions/path failed verification.")
    validate_passphrase(passphrase)
    try:
        private = serialization.load_pem_private_key(path.read_bytes(), passphrase.encode("utf-8"))
    except (ValueError, TypeError):
        raise KeySafetyError("The existing OCI API passphrase did not unlock the key; no retry or cloud call.") from None
    public = private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    if public != (KEY_DIRECTORY / "oci_api_public.pem").read_bytes():
        raise KeySafetyError("Unlocked API key does not match the registered public key.")
    del private
    original = read_profile()
    return {**original, "key_file": str(path), "fingerprint": fingerprint}


def unlock_and_verify(passphrase):
    profile = encrypted_profile(passphrase)
    report = audit(profile=profile, passphrase=passphrase)
    require_free_credential_gate(report, needs_slot=False)
    if report.get("newPublicKeyRegistered") is not True or report.get("newPublicKeyState") != "ACTIVE":
        raise KeySafetyError("Signed encrypted-key identity was not verified; no create.")
    report["status"] = "NEW_ENCRYPTED_API_AUTHENTICATION_PASS"
    report["infrastructureCreates"] = 0
    # Public metadata receipt only; never key material or passphrase.
    write_new(KEY_DIRECTORY / "api-authentication-status.json", (json.dumps(report, indent=2) + "\n").encode())
    return report


def main():
    try:
        if len(sys.argv) != 1 or not sys.stdin.isatty() or not sys.stdout.isatty():
            raise KeySafetyError("Use only the dedicated local terminal; no arguments or piped secret input.")
        os.umask(0o077)
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if (KEY_DIRECTORY / "api-authentication-status.json").exists():
            raise KeySafetyError("An authentication receipt already exists; inspect it before another unlock.")
        print("IR35 G1: unlock the OCI API key you already created. This does NOT generate new keys.", flush=True)
        print("Read-only signed account checks only. No VM/resource creation or cutover.", flush=True)
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            passphrase = getpass.getpass("Existing OCI API passphrase (hidden; enter once): ")
        report = unlock_and_verify(passphrase)
        del passphrase
        print("PASS: new encrypted API key authenticated; ACTIVE Free Trial / London verified.", flush=True)
        print("No infrastructure or production change. Tell Codex: API unlocked.", flush=True)
        return 0
    except (KeyboardInterrupt, EOFError):
        print("STOP: input cancelled. No automatic retry.", file=sys.stderr)
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
    except Exception:
        print("STOP: encrypted-key verification failed; raw errors suppressed. No automatic retry.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
