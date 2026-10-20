#!/usr/bin/env python3
"""Local, interactive G1 only. No cloud calls, secret arguments or key rotation."""

import getpass
import hashlib
import json
import os
from pathlib import Path
import resource
import stat
import sys
import warnings

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa


class KeySafetyError(Exception):
    """Constant, non-secret failure messages only."""


def validate_passphrase(value: str) -> bytes:
    if not 16 <= len(value) <= 256 or any(c in value for c in ("\0", "\r", "\n")):
        raise KeySafetyError("Use a 16-256-character passphrase without line breaks.")
    return value.encode("utf-8")


def private_directory(path: Path, *, create: bool = False) -> None:
    # Refuse symlinked ancestors, including an apparently safe final directory.
    if not path.is_absolute() or path.absolute() != path.resolve():
        raise KeySafetyError("Key directory must be an absolute, non-symlink path.")
    if create:
        path.mkdir(mode=0o700)  # Deliberately no exist_ok or recursive mkdir.
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise KeySafetyError("Key directory must be owned by you with mode 700.")


def write_new(path: Path, value: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    info = path.lstat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
        raise KeySafetyError("Generated key permissions failed verification.")


def create_keys(directory: Path, ssh_passphrase: bytes, api_passphrase: bytes) -> dict:
    # Both must be validated before any key is created or any directory is written.
    validate_passphrase(ssh_passphrase.decode("utf-8"))
    validate_passphrase(api_passphrase.decode("utf-8"))
    private_directory(directory.parent)
    private_directory(directory, create=True)  # Never overwrite even an empty previous run.
    ssh = ed25519.Ed25519PrivateKey.generate()
    api = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    ssh_encrypted = ssh.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH,
        serialization.BestAvailableEncryption(ssh_passphrase),
    )
    api_encrypted = api.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.BestAvailableEncryption(api_passphrase),
    )
    # Verify decryption and public identity in memory, never print private material.
    ssh_public = ssh.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH)
    api_public = api.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    if serialization.load_ssh_private_key(ssh_encrypted, ssh_passphrase).public_key().public_bytes(
        serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH
    ) != ssh_public:
        raise KeySafetyError("SSH key round-trip failed.")
    if serialization.load_pem_private_key(api_encrypted, api_passphrase).public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ) != api_public:
        raise KeySafetyError("API key round-trip failed.")
    for name, content in {
        "ssh_ed25519": ssh_encrypted,
        "ssh_ed25519.pub": ssh_public + b" ir35-oracle-migration\n",
        "oci_api.pem": api_encrypted,
        "oci_api_public.pem": api_public,
    }.items():
        write_new(directory / name, content)
    der = api.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    fingerprint = ":".join(hashlib.md5(der, usedforsecurity=False).hexdigest()[i:i+2] for i in range(0, 32, 2))
    report = {
        "status": "KEYS_CREATED_NOT_UPLOADED", "sshAlgorithm": "ed25519", "apiAlgorithm": "rsa-3072",
        "encrypted": True, "roundTripVerified": True, "apiPublicFingerprint": fingerprint,
        "directoryMode": "700", "fileMode": "600", "cloudCalls": 0,
        "existingRegisteredKeyChanged": False,
    }
    write_new(directory / "status.json", (json.dumps(report, indent=2) + "\n").encode())
    return report


def prompt_twice(label: str) -> bytes:
    # getpass must NEVER silently fall back to echoing stdin in an automation pipe.
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise KeySafetyError("A local interactive terminal is required; no piped passphrases.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        first = getpass.getpass(label + " passphrase (hidden): ")
        validate_passphrase(first)
        second = getpass.getpass("Confirm " + label + " passphrase (hidden): ")
    if first != second:
        raise KeySafetyError("Passphrases did not match; stopped without retrying.")
    return validate_passphrase(first)


def main() -> int:
    try:
        if len(sys.argv) != 1:
            raise KeySafetyError("No arguments accepted; enter passphrases only at the hidden prompts.")
        if not sys.stdin.isatty() or not sys.stdout.isatty():
            raise KeySafetyError("A local interactive terminal is required; no piped passphrases.")
        os.umask(0o077)
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        root = Path.home() / ".ir35"
        if not root.exists():
            private_directory(root, create=True)
        private_directory(root)
        parent = root / "keys"
        if not parent.exists():
            private_directory(parent, create=True)
        private_directory(parent)
        destination = parent / "oracle-migration-20261020"
        if destination.exists() or destination.is_symlink():
            raise KeySafetyError("A previous key directory exists; no overwrite or automatic retry.")
        print("IR35 migration G1: local keys only. No upload, provisioning or cutover.", flush=True)
        print("Save both passphrases and encrypted private keys in your password manager.", flush=True)
        ssh_passphrase = prompt_twice("SSH")
        api_passphrase = prompt_twice("OCI API")
        create_keys(destination, ssh_passphrase, api_passphrase)
        del ssh_passphrase, api_passphrase
        print("PASS: encrypted SSH/API keys created and verified. No cloud changes.", flush=True)
        print("Private files are in: " + str(destination), flush=True)
        print("Only .pub and oci_api_public.pem may be uploaded. Keep this window open.", flush=True)
        return 0
    except (KeyboardInterrupt, EOFError):
        print("STOP: owner input cancelled. No automatic retry.", file=sys.stderr)
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
    except Exception:
        # Crypto/OS errors can embed paths/input. No traceback or raw exception.
        print("STOP: key setup failed. Preserve existing files for local inspection; no automatic retry.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
