# Exact Storage release repair — PASS, full P4 not yet signed off

21 October 2026. Owner-approved staging only; [PR53](https://github.com/IR35careers/IR35/pull/53) stays draft/unmerged. No cloud/Vercel/production/DNS/acceptance change or cutover.

| Gate | Result |
| --- | --- |
| Exported history | PASS74rows, re-read only after the entire storage.migrations fingerprint matched the frozen cloud archive/source bundle. Both historical hashes preserved. |
| Official release search | PASS776tags considered;47compatible, including v1.80.2; no pending/missing/altered migrations. |
| Native ARM digest | PASS official arm64 manifest/config; no source build/publication needed. |
| Actual image loader | PASS74IDs/names/hashes,0pending/0missing/0altered; network-none128MiB fixture, no DB connection/API start. |
| New clean full restore | PASS ir35_storage_compat_a_20261021 once/22.659s for restore+table/schema checks only; frozen source archive, atomic native restore WITH owners/ACLs and reviewed normalization; no role/password change. |
| Schema/security | PASS3752objects/0unexplained differences, exactly3approved extension-owner fields;327supplemental/62extensionACL/198DDL/552effective privilege/16expiry checks match. |
| Every row/Auth/sequence | PASS62tables incl27Auth/password-hash bytes and2sequence states; repeated after all Storage HTTP tests,0differences. |
| Storage boot/bytes | PASS one private512MiB API start; all73files/1,241,375bytes through actual API match SHA256/length. Internal network/no public ports/restart=no/log-driver=none. |
| Signed URLs | PASS73generated URLs/downloads; invalid-token negative denied. Tokens in VM RAM only. |
| Anon/authenticated RLS | PASS73object checks per role and bucket-list equality vs fresh read-only cloud SQL policy evaluation. Named test account owns none of these73files: all denied for both roles; valid JWTs receive200empty bucket lists. Service/signed-URL positive controls retrieve every file. No customer impersonation/cloud login. |
| Post-startup/original protection | PASS all62fingerprints/2sequences/schema/security, old quarantined73files and original9protected services/eight healthy backends/Basic/noindex/mock/sink/acceptance=false. |
| Auth startup before asking for credentials | PASS pinned Auth health and full62table/2sequence/schema/security comparison remain identical. Temporary internal Auth is now stopped at READY_STOPPED, loginAttempts0; no password requested/submitted. |
| Full P4/P5 | NOT COMPLETE: true Auth login, reverse rehearsal, two complete consecutive timed cycles and guarded wipes remain. |

Pin: `supabase/storage-api:v1.80.2@sha256:5e290c10a57893024dea5b41764e2fd81d02b379e5853bdd1da11e74bd58783e`. Source commit `db42280506a07a165376219b2d6ac7bc92ccdfcc`; index `sha256:95b217a9c59e0ac06c6dcb539df3189a1668a2445fb43dbf29660d6968ffd7d2`. Separate infra/oracle/storage-compatible-image.json; original runtime pins/FAIL2evidence unchanged. Old global rehearsal gate remains closed; new independent compatibility path only.

Evidence: [export history](oracle-p4-storage-exported-history.json), [release verdicts](oracle-p4-storage-release-search.json), [native fixture](oracle-p4-storage-image-fixture.json), [clean restore](oracle-p4-storage-compatible-restore.json), [cloud RLS baseline](oracle-p4-storage-access-source.json), [API/signed/RLS](oracle-p4-storage-compatible-api.json), [full post-audit](oracle-p4-storage-compatible-post-audit.json), [old-copy/runtime protection](oracle-p4-protection.json).

Successful temporary compatibility API container and its temporary operational env were removed after checks. New DB/private log/files remain protected; old failed container/archive/bundle/log/journal retained, never replayed/reset/wiped. No raw customer names/paths/records, SQL bodies, credentials or URL tokens public.

Next owner credential gate: existing password for the named test account, entered once in the dedicated hidden prompt, never chat. No OCI/API/SSH passphrase or cloud login. The prepared test re-checks full snapshot equality before using the password, verifies the fresh staging JWT, logs out only that new test session, and stops/removes only its owned temporary Auth container/env. Deliberate test-account login/audit writes are staging QA, not a claim that post-login Auth rows still equal the pre-login snapshot. No reset or cloud write. Remaining reverse/two-cycle/wipe gates follow before P5.

## Tooling repairs, not migration-history repairs

The initial public-tag scan on the Windows-mounted cache was stopped before a verdict, moved to a Linux cache and optimized to reject tags missing the final migration without fetching every old SQL blob. All776tags completed. One escaped local diagnostic failed PowerShell parsing before SSH, then replaced by a typed helper. No assertion/timeout/comparison relaxed.

Auth prerequisite initially counted only GoTrue filenames and reported7historical rows missing. Read-only GoTrue bootstrap search did not resolve them. Second documented repair checked the pinned Postgres bootstrap: exact source/native file hashes match and it inserts those7legacy versions.75GoTruefiles+7Postgresseeds=82cloud versions,0pending/0unexplained; no Auth start/login/write yet. Original two incomplete diagnostic results are recorded; this is proven seed provenance, not a waiver/history deletion. No further repair loop for that step. Two local documentation patch context errors made no file changes before this corrected patch.

Sources: [official release](https://github.com/supabase/storage/releases/tag/v1.80.2), [pinned migration validation](https://github.com/supabase/storage/blob/v1.80.2/src/internal/database/migrations/migrate.ts), [pinned Postgres Auth seed](https://github.com/supabase/postgres/blob/17.6.1.136/migrations/db/init-scripts/00000000000001-auth-schema.sql).
