# P8 owner batch — local custody STOP, no native activation

28 October 2026. This records work under the new Caddy/age/narrow-backup-IAM approval, not a replay or deletion of the three earlier CI failures. [Write-once result](oracle-p8-owner-batch-custody-stop-20261028.json). No VM, OCI, production, DNS, provider, real-email or employer operation occurred in this batch. No key was generated. All changes below remain local/uncommitted/unpushed because the custody preflight stopped the batch.

## Results

| Gate | Result |
| --- | --- |
| Caddy error-header source repair | Prepared: explicit error chain preserves status/Basic challenge and supplies deferred no-store/noindex/request-ID/Server removal. Original six cases, assertions, expected values and timeouts unchanged; four supplemental error-path cases added. |
| Official Caddy 2.10.2 local adapt/validate | PASS on synthetic config only; not Docker, staging reload or end-to-end fixture evidence. |
| Fresh-home full offline helper suite | **715 PASS**, 59.704 seconds, no `.ir35` before/after, private files/keys/VM calls zero; [sealed manifest](p8-owner-batch-hermetic-01/manifest.json), SHA256 `4650bf9bd67c1e0a24d425af4d26e998b90c7b7bba7b39c01c540f9db9666955`. |
| Public staging root, read-only HTTPS | 401 already supplies `no-store` and `noindex, nofollow, noarchive`; Server=Caddy. This is neither all response paths nor authenticated SDK proof. |
| Native Caddy reload | NOT ATTEMPTED. Repository pin is 2.10.2 with admin off; that version's signal handler does not implement signal reload. Need live read-back before deciding whether any config repair is required or reload is possible; no restart/admin weakening/upgrade authorized. |
| Official age release provenance | PASS: v1.3.2 ZIP publisher SHA256 and offline Sigsum proof verified with pinned v0.13.1 verifier, frozen `sigsum-generic-2025-1` policy and release-pinned public signing keys. Public hashes are in the result; no private key material exists. |
| Local age destination custody | **STOP BEFORE GENERATION**: directory owner=current user; only current-user and SYSTEM allow entries, both inherited; inheritance remains enabled. No extra reader was observed, but the required pinned parent DACL is absent. No ACL change, intent reservation, private identity or encryption/decryption run occurred. |
| Backup IAM/lifecycle | Pure policy/budget/upload/lifecycle validators prepared; 12 tests included in full suite. No group, policy, lifecycle, upload, timer or bucket mutation performed. |
| Full original containment | Not rerun: WSL has a new boot, expected SSH identity is not loaded, native agent unavailable. OCI session helper requires the daily browser sign-in before any cloud request. No access window or passphrase prompt was opened. Historical PASS is not a fresh PASS. |
| PostgreSQL 17.11 P9 item | Prepared in separate P9 worktree `C:\ir35-p9-pg17`, draft branch unchanged/unpushed. Five offline runbook tests PASS; no image selected/pulled or DB upgraded. See [minor-update plan](../oracle-postgres-minor-upgrade-plan.md). |
| P8 / P9 / cutover | **P8 incomplete. P9 preparation only, NO-GO. YES CUTOVER absent.** |

## Exact VM policy — PREPARED, NOT CREATED

Dynamic group `ir35-backup-vm`, matching only:

```text
instance.id = 'ocid1.instance.oc1.uk-london-1.anwgiljrr72xucychx35t4jbeiaep4qncwolllegqazy3krrryoz7pxqusya'
```

```text
Allow dynamic-group ir35-backup-vm to manage objects in compartment id ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq where all {target.bucket.name='ir35-backups', any {request.permission='OBJECT_CREATE', request.permission='OBJECT_INSPECT', request.permission='OBJECT_READ'}}
```

The permission filter is exact: no VM delete/overwrite, bucket management or tenancy-wide grant. Live effective policies, name collisions, exact bytes including versions/multipart, requests and actual Free account/limits still need authenticated read-back. Use instance principal and create-only single-part uploads; OCI multipart/stdin convenience needs broader permissions and is forbidden here. Preserve the stricter **8 GB including upload overlap**, Standard-only rule and outer free envelope. Never subtract anticipated lifecycle deletions to fit an upload.

**Lifecycle prerequisite, not self-approved:** Oracle requires its separate regional Object Storage service principal to have lifecycle deletion permissions. Read-only inspection must first prove whether the narrow equivalent already exists. If absent, stop for the owner's separate service-only permission decision; do not grant DELETE to the VM or silently install Oracle's broad example. [Oracle lifecycle service permissions](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usinglifecyclepolicies.htm#Required_IAM_Policies).

No fresh Always Free usage/cost claim is possible while cloud authentication is unavailable. Historical 27 October evidence recorded 2 OCPU/12 GB, 150 GB allocated boot+block, zero volume backups and exactly zero Standard Object Storage bytes; that stale inventory and a lagging GBP0 report are not current billing proof.

## Retained tooling evidence

- Go bootstrap first download omitted redirect following: retained **75-byte HTML redirect**, SHA256 `44639d223f448077893451cbb7dda762d85906186842a2f16868c65a5c940db2`; never extracted or executed. Published release metadata still required **70,588,678 bytes**, SHA256 `65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40`.
- Corrected download produced those exact published bytes/hash. A shell-substitution guard then failed before extraction; separate native read-only validation proved size/hash, followed by the guarded extraction/build. No expected hash was changed. Verifier built with fixed module version, explicit public proxy/checksum database and no cloud credentials.
- First Sigsum invocation could not see the Windows-local cache through the WSL mount. Only public release assets were copied to a new WSL-local tool directory; verification then exited 0. No private identity, credential or VM file was copied. All failed files/commands remain retained; no gate evidence was overwritten.
- Fake-age native fixture repairs from the independent helper task are retained: initial Set-Acl privilege error, first repair exit1 with unknown stderr, final authorized DACL-only Win32 repair PASS16. Real ceremony remains unconsumed. Mutation code only protects newly reserved empty files; it never silently changes an existing parent directory.

## One batched owner handoff

1. Decide whether to pin the **existing approved folder's** inherited DACL explicitly to the current owner plus SYSTEM, preserving its owner and contents, then recheck before any key generation. No permission change was made; do not relax the custody assertion or move a private key into the repo/VM.
2. When ready at the laptop, complete one fresh normal Oracle sign-in and one native hidden SSH unlock for the **new WSL boot**. Neither prompt is open. No OCI API passphrase is needed; the earlier no-lifetime agent lease did not survive the boot. Check fingerprint first, and do not ask merely because time has elapsed.
3. Remaining Caddy supported-reload and lifecycle-service-permission questions are conditional on live read-only audit, not requests to approve broader access now. The backup/restore/reverse-sync/native QA/monitoring gates remain unexecuted; no original verification baseline was waived.
4. After a successful key generation: **store an offline copy of the age key file in your password manager or on a USB drive**. Intended identity path is `C:\Users\anves\.oci\ir35-p0-readonly\oracle-backups-age.identity`; it does **not** exist yet.

All draft PRs remain unmerged. No new CI gate was triggered after this local custody STOP. No production dependency has moved, and the old stack remains intact.
