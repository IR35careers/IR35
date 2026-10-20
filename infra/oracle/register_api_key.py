#!/usr/bin/env python3
"""Register only the G1-generated public key, with a durable no-retry intent."""

import hashlib
import json
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from bootstrap_audit import KEY_DIRECTORY, audit, cli_json, prepare_config, read_profile
from key_ceremony import KeySafetyError, private_directory, write_new


def check_public_key(directory):
    private_directory(directory)
    path = directory / "oci_api_public.pem"
    if path.is_symlink() or path.stat().st_size > 4096:
        raise KeySafetyError("Expected small generated RSA public key is unavailable.")
    public = serialization.load_pem_public_key(path.read_bytes())
    if not isinstance(public, rsa.RSAPublicKey) or public.key_size != 3072:
        raise KeySafetyError("Only the generated RSA3072 PUBLIC key may be uploaded.")
    digest = hashlib.md5(public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo), usedforsecurity=False).hexdigest()
    fingerprint = ":".join(digest[i:i+2] for i in range(0, 32, 2))
    status = json.loads((directory / "status.json").read_text())
    if status.get("apiPublicFingerprint") != fingerprint or status.get("roundTripVerified") is not True or status.get("encrypted") is not True:
        raise KeySafetyError("Generated public fingerprint/verified encryption metadata does not match.")
    return fingerprint


def require_free_credential_gate(report, *, needs_slot=True):
    if report.get("signedTenancyMatch") is not True or report.get("activeUserMatch") is not True or report.get("homeRegion") != "uk-london-1" or report.get("regionStatus") != "READY":
        raise KeySafetyError("Live signed account/region gate did not pass.")
    subscriptions = report.get("subscriptions")
    if not subscriptions or any(s.get("state") != "ACTIVE" or s.get("paymentModel") not in ("FREE_TRIAL", "FREE_AND_TRIAL") for s in subscriptions):
        raise KeySafetyError("Live subscription is not proven ACTIVE Free Trial; no upload.")
    if report.get("oldPublicKeyStillRegistered") is not True or report.get("newKeyEncryptedRoundTrip") is not True:
        raise KeySafetyError("Old-key preservation/new-key encryption gate did not pass.")
    count = report.get("registeredApiKeys")
    if type(count) is not int or not 1 <= count <= (2 if needs_slot else 3):
        raise KeySafetyError("No free API-key slot proven; do not revoke any existing key.")


def register():
    fingerprint = check_public_key(KEY_DIRECTORY)
    report = audit()  # Fresh signed account and actual key usage immediately before upload.
    intent = KEY_DIRECTORY / "api-registration-intent.json"
    receipt = KEY_DIRECTORY / "api-registration-receipt.json"
    if report["newPublicKeyRegistered"]:
        require_free_credential_gate(report, needs_slot=False)
        if report.get("newPublicKeyState") != "ACTIVE":
            raise KeySafetyError("Registered public key is not yet ACTIVE; no upload retry.")
        return {"status": "PUBLIC_KEY_PRESENT", "publicFingerprint": fingerprint,
                "oldKeyPreserved": report["oldPublicKeyStillRegistered"], "createRetried": False}
    require_free_credential_gate(report)
    if intent.exists() or intent.is_symlink() or receipt.exists() or receipt.is_symlink():
        raise KeySafetyError("Previous upload intent exists but key is not observed; reconcile, never retry blindly.")
    print("CREATE CHECK: IAM RSA3072 PUBLIC signing-key registration only; no VM/shape/volume. "
          "OCI IAM Free; signed ACTIVE Free Trial/London; actual key usage below the three-key limit. "
          "No paid identity service, new user, policy, plan or billing change.", flush=True)
    print("Free eligibility reference: https://www.oracle.com/europe/security/cloud-security/pricing/", flush=True)
    write_new(intent, json.dumps({"status": "PENDING", "publicFingerprint": fingerprint,
                                 "checkedAt": report["checkedAt"], "freeCheck": report}).encode())
    profile = read_profile()
    result = cli_json(prepare_config(profile), ["iam", "user", "api-key", "upload", "--user-id", profile["user"],
                                               "--key-file", str(KEY_DIRECTORY / "oci_api_public.pem")], public_key_upload=True)
    if not isinstance(result, dict) or result.get("fingerprint") != fingerprint:
        raise KeySafetyError("Upload response identity is unproven; retain pending intent and reconcile.")
    after = audit()  # Independent list read-back; no repeated create, no deletion.
    if after["newPublicKeyRegistered"] is not True or after.get("newPublicKeyState") != "ACTIVE" or after["oldPublicKeyStillRegistered"] is not True:
        raise KeySafetyError("Public-key read-back did not pass; retain intent and reconcile.")
    answer = {"status": "PUBLIC_KEY_REGISTERED", "publicFingerprint": fingerprint,
              "oldKeyPreserved": True, "registeredKeyCount": after["registeredApiKeys"],
              "checkedAt": after["checkedAt"], "newKeyAuthentication": "NOT_YET_TESTED", "infrastructureCreates": 0}
    write_new(receipt, json.dumps(answer, indent=2).encode())
    return answer


if __name__ == "__main__":
    try:
        if len(sys.argv) != 1:
            raise KeySafetyError("No arguments accepted for public-key registration.")
        print(json.dumps(register(), indent=2))
    except KeySafetyError as error:
        print("STOP: " + str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("STOP: key registration could not be verified. Reconcile before any retry; no raw error output.", file=sys.stderr)
        raise SystemExit(1)
