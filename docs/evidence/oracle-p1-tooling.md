# P1 tooling / G1 checkpoint — 20 October 2026

Status: **P1 INCOMPLETE — key creation G1 passed; encrypted-key authentication unlock required**. No Compute/network/volume create, shape eligibility or hosted health result is implied.

Draft [PR#49](https://github.com/IR35careers/IR35/pull/49), stacked on unmerged P0#47; no merge or deployment. Final-head hosted checks are not a local-test claim.

| Check | Observed result |
| --- | --- |
| WSL | Ubuntu24.04.1 / WSL2, local user anvesh. |
| CLI repair | PASS: isolated `/home/anvesh/.ir35/oci/bin/oci --version` =>3.95.0; `oci_cli.util` imports; SDK2.188.0. No global Windows MAX_PATH change. |
| Local key dependencies | Isolated cryptography50.0.2/bcrypt5.0.0 installed; no web/worker runtime change. |
| Key helper | PASS: **10 real Linux tests**, including encrypted round-trip, wrong/no-password rejection, native SSH public-key parsing, actual PTY ECHO-off/no-passphrase-output proof, no overwrite/symlink/shared-parent and safe error handling. |
| Capacity state | PASS: **32 focused tests**. Initial plus three capacity retries, no fifth launch after serialized restart; ambiguous result remains pending. No cloud call. |
| Release suite | PASS: `npm run verify:release` exited0: strict TypeScript, zero-warning ESLint, **930 unit tests /141 files, zero skips +199 legacy checks**. No existing assertion/timeout weakened for resource contention; capacity assertions updated to the new owner limit. |
| Source / dependencies / syntax | PASS: **756 tracked files and Git history** scanned; audit only the two already approved exact exceptions expiring29October. `pip check` clean. Modified workflow parses; PowerShell launcher parses. Hosted final-head CI remains separate/pending. |
| New real SSH/API keys | PASS: owner completed G1; local metadata verifies encrypted Ed25519/RSA3072 round trip, directory700/files600 owneranvesh. No private values displayed. |
| Live signed account check | PASS at20October03:25UTC: matching tenancy/ACTIVE user, sole READY London home region, ACTIVE/FREE_TRIAL subscription. Legacy registered key used only for the bootstrap read/public registration; original config/key unchanged. |
| Public API-key registration | PASS: one RSA3072 **public** key upload, durable intent before call, independent ACTIVE read-back; now3registered keys, old bootstrap key remains. No delete/revoke/policy/user/plan change. New encrypted key authentication **NOT YET TESTED**. |
| Resource create / capacity launch | No Compute/network/volume/bucket create; zero capacity attempts. No instance OCID/public VM IP/hosted health. Fresh per-resource shape/limits/quota/usage/cost evidence remains required. Existing budget is historical, not duplicated. |
| Production / DNS / secrets / runner | UNCHANGED. No Vercel/Supabase mutation, deployment, production env change, real application or cutover. Only cloud write: the requested IAM public-key registration. |

### Registration and unlock safeguards

The new narrow bootstrap CLI wrapper permits only exact account/key-list read commands and the exact generated public-key upload. It strips inherited OCI overrides, refuses debug/endpoint/extra flags, uses bounded timeouts and `--no-retry`, and suppresses provider bodies/raw errors. Generated local config contains **public identifiers and key paths only**, owner600, no passphrase, no overwrite/symlink/hardlink. The original owner/SYSTEM-only Windows key directory ACLs were rechecked; its private material was not printed or copied. New identity authentication is separate from a successful public upload.

**22 Linux tests pass**, including registration intent-before-upload/read-back, unknown-outcome/no-blind-retry, paid/unknown/full-slot refusal, exact-command validation, raw-error credential redaction (including a passphrase matching an error code), and encrypted-key unlock success/wrong-password refusal. Unlock tests use disposable mock keys, not the owner's passphrase. A dedicated new terminal asks for the **existing OCI API passphrase once**, not a new key or SSH passphrase; it verifies locally, passes the unlock only in child-process RAM, makes read-only signed account calls and writes a metadata-only receipt. No passphrase is saved in config/args/logs. No automatic retry on wrong input.

Follow-up source/history scan passes **761 tracked files**; dependency audit retains only the two prior owner-approved exact advisories until29October. Launcher/workflow/diff syntax checks pass. All10hosted checks passed at the earlier preparation head `142cf9740065b3bf8bc247cf04fa7f5c405eb835` (ARM mock, Docker standby, release build, security, CodeQL and3responsive browser jobs). The new helper head needs its own hosted checks; these old results are not relabelled as its PASS. The owner-key authentication receipt is absent before the unlock, as expected.

OCI signing-key registration is a free IAM credential operation, not a paid shape/volume or identity-plan upgrade. Current account/key usage was read immediately before the one upload. References: [free core IAM pricing](https://www.oracle.com/europe/security/cloud-security/pricing/), [three-key limit/public upload](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/apisigningkey.htm), [pinned CLI upload parameters](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/iam/user/api-key/upload.html). This is **not** a real-time billing-zero guarantee or permission to bypass later Always Free labels/usage checks.

Reproducible local checks (no owner key values):

```sh
/home/anvesh/.ir35/oci/bin/oci --version
# From the short-path copy of public tooling only:
/home/anvesh/.ir35/oci/bin/python -m unittest discover -s tests -v
# In the repository with installed dependencies:
node node_modules/vitest/vitest.mjs run tests/unit/oracle-provisioning.test.ts
```

G1 uses a dedicated visible local terminal, **not chat or a browser form**. `key_ceremony.py` accepts no arguments, refuses non-TTY input and getpass echo fallback, asks each passphrase twice and stops on mismatch. It generates encrypted Ed25519 OpenSSH and RSA3072 PKCS8 files only after both entries validate, verifies decryption/public-key equality, uses owner mode700/600/no-follow/exclusive writes and never touches the old registered key. The fixed new directory prevents silent overwrite/retry. Status JSON contains only non-secret metadata/public fingerprint. Native core dumps are disabled in the interactive process.

Owner must save both encrypted private keys and passphrases in the password manager. Private files stay on the laptop; only SSH `.pub` and `oci_api_public.pem` may be uploaded later. API/SSH keys are distinct; Oracle requires RSA for API signing. No private key, passphrase or full CLI configuration belongs in this repository or evidence.
