# P4 separate recovery run — 21 October 2026

Status: **snapshot/Storage/synthetic gates PASS; named-password owner gate READY_STOPPED; P4 incomplete**. Draft [PR53](https://github.com/IR35careers/IR35/pull/53), never merged. The owner approved this NEW read-only snapshot and separately journalled rehearsal; the damaged original reference and all earlier failures remain failures, not relabelled PASS. No production/cloud writes, Vercel, dashboard, DNS, Google, IAM, paid resources or cutover changes.

Run `p4_20261021T170139Z_8be0fc2e`, isolated DB `ir35_p4_20261021t170139z_8be0fc2e`. Public reports are [in the run directory](p4-recovery/p4_20261021T170139Z_8be0fc2e). Raw dumps, role/schema definitions, private object paths, logs and credentials are NOT in this repository.

## Original incident preserved

Same-filesystem no-replace move into `/opt/ir35/incident/20261021T170139Z_8be0fc2e/00-evidence`, owner ir35, stage500/files400. Parent700. Bytes verified before unlinking the original names; nothing deleted from the archive. Original dump and both physical quarantines remain unmoved. [Incident manifest](p4-recovery/p4_20261021T170139Z_8be0fc2e/incident.json), also posted in [PR53](https://github.com/IR35careers/IR35/pull/53#issuecomment-6321753912).

| Original artifact | Bytes | SHA256 |
| --- | ---: | --- |
| Damaged verification JSON | 540 | `ca442a732e6c0c9b53cb2d785cae8bb6a2ace45b9e05cec7aa4adc5d11f232d2` |
| Unused additional-attempt preflight journal | 537 | `486daeccdb2d0eda27ea7c6767ed02127d06b1d0d758965cb8be90b91e17d595` |
| Original denied-login journal | 274 | `a6d4d81f69b55711bd0009ddb0b8b222192140b9f41b5018b9b035f9dae4d76c` |
| Original rehearsal failure journal | 688 | `25ee2fdb7035118e82af8e0a350204fbbb17841b9226a26bcea29226dec3ccbf` |
| First restore log | 54,164 | `4a9006d0938bb3c5097251b20bfbb3cefa3d64c9f5c9985c44b347d56e1a5462` |
| Compatible-image restore log | 54,164 | `4a9006d0938bb3c5097251b20bfbb3cefa3d64c9f5c9985c44b347d56e1a5462` |

Incident manifest SHA256: `7c1ddd164a3a4491c53f30cf279ca3e16edc9d2c38ee7fa7828539a4be7a359c`. Historical raw GoTrue response/logs were never persisted with driver `none`; no missing historical log was fabricated.

## Write-once recovery protocol

Each run and stage is exclusive. `O_EXCL|O_NOFOLLOW` refuses existing files, including failed reports/logs; stage creation refuses replay. Files fsync and seal400, stage500, manifest400. Every later step checks externally recorded SHA256 manifest anchors, complete artifact coverage/custody, operational env-file hashes/mode600, and all physical Storage bytes/metadata. Runtime env files remain under the private run's `.env*` hierarchy; no credential appears in an argument, report or public log. Each helper executes in its own module namespace, with explicit capability/result transfer, so its global names cannot redirect another writer. These guards detect tampering/tool bugs; they are not a claim of protection against a malicious root administrator.

New source capture: **17:02:40.996662Z–17:04:33.225520Z**,112.229s, cloud PostgreSQL17.6, native pg_dump/psql17.11. Read-only repeatable-read transaction, verify-full TLS. LSN `34/6B000BD8`; metadata snapshot alias `00000005-0000F0A4-2`. The dump used the first export from the SAME live transaction; the metadata query exported the second alias, not a second transaction. The first alias was not separately persisted in this sealed run; it is not reconstructed. LSN, transaction binding and identical source/target checks are recorded. Future captures now record both aliases explicitly.

Native custom dump **12,401,232 bytes**, SHA256 `3d758a94a09581902316bfa707982047230ac1cff45e7a6413c86a1071a917fd`; reference SHA256 `44f872beeb240d85dedb57a8d3af616bfeeabcf7fc1052326c07e126e5ad38f4`. GET-only Storage bytes and metadata are snapshot/stability checked. Restore is a NEW template0 isolated DB, atomic WITH owners/ACL/defaults and full private write-once log, never the old target or production. Approved unused-CLI-expiry alignment and original narrow owner/ACL normalization only.

## Actual gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Archive/dump/reference custody | PASS | incident.json, receive.json, restore-summary.json |
| All62table exact counts/ordered MD5, including27Auth/password-hash byte coverage | PASS | verify.json |
| Both sequence values/is_called; UTF8/collation/Unicode | PASS | verify.json/transport |
| 3,752schema objects; RLS/policies/grants/roles/triggers/functions | PASS,0unexplained; ONLY3approved extension-owner fields | verify.json |
| 552effective app-role privileges, extension ACL/DDL conditions,327supplemental objects | PASS,0broader | verify.json |
| All73physical files/1,241,375bytes, SHA256/metadata/coverage; bucket properties via DB fingerprints | PASS | storage.json |
| Actual compatible frozen/read-only Storage API and73signed-URL byte downloads | PASS repair1; full post-API fidelity PASS | storage-api-repair-1.json |
| Controlled Kong password400 with request-ID-correlated redacted GoTrue logs | PASS | synthetic-2.json |
| Synthetic RAM-password login, actual signed JWT/user endpoint, refresh, positive own-profile RLS and cross-owner/anon negatives | PASS repair1 | synthetic-2.json |
| Synthetic identity-checked deletion and pristine full post-test fidelity | PASS | synthetic-2.json |
| Named-account startup/restart/config/diagnostic/full-fidelity preflight | READY_STOPPED; password requests0 | named-ready.json |
| Remaining owner-entered password, session/refresh/RLS and sink magic link | NOT RUN; owner gate | No substitute synthetic PASS |
| Two COMPLETE timed rehearsal cycles, reverse-sync rehearsal, guarded wipes | NOT COMPLETE | No P4/P5 signoff |

This snapshot is the comparison source, not today's moving cloud tables. Fingerprints are never compared across unrelated snapshots. Auth writes from synthetic testing live in a SEPARATE database clone `_syn2`; the original failed `_syn1`, untouched pristine DB and old evidence remain. The synthetic account was deleted via Auth with identity read-back, not by truncating tables or resetting sequences to manufacture parity. The named attempt has its own `_named` clone.

## Diagnosed bounded repairs (old FAIL evidence retained)

1. Storage API first run: `PrivateServiceAddressRequired`, REST exited111. Root cause: my helper passed a nested run path to the native launcher's deliberately flat container-env path guard. Fixed the bind destination, NOT the guard; actual native launcher tests PASS. Separate repair1 PASS, repair2 unused. Full post-failure fidelity PASS.
2. Synthetic first run: `TimeoutExpired` before any user/password creation. Root cause independently reproduced read-only: local `docker attach --sig-proxy=false` ignores TERM, so its cleanup wait threw before preserving the already received controlled400 diagnostic. Original Auth container start/state unchanged. Fixed bounded termination of the LOCAL observer process only (kill after TERM timeout, no signal proxy), regression-tested; separate `_syn2` repair1 PASS. No real credential used. Repair2 unused. See observer-audit.json and retained synthetic-1.json.

The original named-account HTTP400's exact cause is still **unproven** because its body/logs were not saved. Code comparison proves the original body keys were email/password and its request was direct Auth `/token`; the new synthetic AND named paths share one function through Kong `/auth/v1/token?grant_type=password` with apikey. This is a boundary comparison, not proof of the original error cause. The new controlled400 proves future error_code/msg/request-ID-log diagnostics are captured without a real password; response IDs absent from headers/body are explicitly null while client-ID-correlated server logs are retained.

Pre-publication review caught the restore normalizer's full private catalog in its LOCAL result projection. It was never committed/pushed. Original bytes preserved outside Git, SHA256 `6730d93c935c1ebada9633bdfc26ed42e0d5177c9fd0f1631107b5dc0085e2a9`, owner400; a DIFFERENT `restore-summary.json` publishes only repair counts and the unchanged VM manifest anchor. All VM originals/manifests remain intact. One local archive-reader repair: the CLI session reader correctly rejected a catalog larger than64KiB; its guard remains unchanged, and the explicit catalog archiver independently enforces size/custody/hash/no-overwrite. Regression checks private byte preservation and absence of catalog values from the public summary. No raw catalog/credential/customer rows published.

Final local verification: **249Linux helper tests**, **946Vitest/149files +199legacy checks**, strict types/full zero-warning ESLint, both PowerShell parsers, whitespace and source/history scan PASS. Dependency audit PASS with ONLY the two existing owner-approved advisory exceptions through29October; no new exception. Hosted CI for the new draft head is separate, not claimed PASS.

## One remaining hidden attempt

Only `p4_recovery.py --named-status` may return READY_STOPPED after checking all manifest anchors, actual synthetic proofs/deletion, retained original denial/unused attempt, env custody and stopped isolated containers. Launcher does that BEFORE hidden Read-Host. The one-use `10-named-login` directory/intent is created exclusively before any password POST; collision/pending/failure refuses replay. No automatic password retry or reset. Password travels hidden UI -> stdin -> encrypted SSH stdin -> VM memory only. Status preflight reads no password. The real call uses exactly the synthetic-tested boundary, then JWT/user/refresh/RLS/logout and pristine post-fidelity. Owned test containers stop on all paths. Failure retains projected error_code and correlated logs and STOPS.

P4 remains incomplete until that named login and all remaining phase gates actually pass; magic link is extra signal only. No P5 deployment, production/DNS/Google/provider change, merge or **YES CUTOVER**.
