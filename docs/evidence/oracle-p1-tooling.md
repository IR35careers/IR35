# P1 tooling / G1 checkpoint — 20 October 2026

Status: **P1 INCOMPLETE — owner G1 required**. No fresh OCI eligibility/create/VM or hosted health result is implied.

| Check | Observed result |
| --- | --- |
| WSL | Ubuntu24.04.1 / WSL2, local user anvesh. |
| CLI repair | PASS: isolated `/home/anvesh/.ir35/oci/bin/oci --version` =>3.95.0; `oci_cli.util` imports; SDK2.188.0. No global Windows MAX_PATH change. |
| Local key dependencies | Isolated cryptography50.0.2/bcrypt5.0.0 installed; no web/worker runtime change. |
| Key helper | PASS: **10 real Linux tests**, including encrypted round-trip, wrong/no-password rejection, native SSH public-key parsing, actual PTY ECHO-off/no-passphrase-output proof, no overwrite/symlink/shared-parent and safe error handling. |
| Capacity state | PASS: **32 focused tests**. Initial plus three capacity retries, no fifth launch after serialized restart; ambiguous result remains pending. No cloud call. |
| Release suite | PASS: `npm run verify:release` exited0: strict TypeScript, zero-warning ESLint, **930 unit tests /141 files, zero skips +199 legacy checks**. No existing assertion/timeout weakened for resource contention; capacity assertions updated to the new owner limit. |
| Source / dependencies / syntax | PASS: **756 tracked files and Git history** scanned; audit only the two already approved exact exceptions expiring29October. `pip check` clean. Modified workflow parses; PowerShell launcher parses. Hosted final-head CI remains separate/pending. |
| New real SSH/API keys | NOT CREATED; owner hidden G1 entry required. Existing registered API key unchanged. |
| New live OCI free/usage/cost evidence | NOT RUN. Historical19October evidence is not sufficient before a create. |
| Resource create / capacity launch | NONE / zero attempts in this phase. No new OCIDs or public VM IP. Existing budget is historical, not newly created. |
| Production / DNS / secrets / runner | UNCHANGED. No deployment, upload, production env mutation, real job or cutover. |

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
