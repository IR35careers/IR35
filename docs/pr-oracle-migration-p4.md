# Oracle P4: guarded full-copy rehearsal and every-row verification

Stacked draft on baseline52, staging only. No merge or production deployment. Source cloud/Vercel/DNS remain untouched and source access is read-only over verify-full TLS. No employer submissions; sink/mock/acceptance=false remain required.

## Current actual results

- Extended schema transport:327objects each on both independent schema targets,0differences/0new exceptions (publications/memberships, all type ACLs, event triggers, foreign metadata and statistics/collations).
- Native ARM synthetic row-hash fixture PASS: ordered UTF8/NULL/empty/binary values, streamed COPY framing, transaction rollback. Two Python framing tests plus native proof, no customer fixture rows persisted.
- Snapshot-bound source fingerprint PASS across all62tables and2sequences,54.321seconds. All Auth rows/password-hash bytes are included by the whole-row fingerprints, never printed. Source snapshot now147users/148identities/73storage objects, not historical inventory counts.
- Source Storage GET-only byte capture PASS:73objects; every byte SHA256, exact size, hashed public paths, fresh-snapshot metadata stability, no source writes/key persistence/target import.
- Full restore/target comparison, Storage API read-back, two consecutive rehearsals/wipes, reverse rehearsal and test-account login: pending actual execution. No zero-loss/P4/P5 signoff from source-only results.

## What changed / risk

Streaming deterministic text casts with NULL/byte-length framing, PK order or C-collated all-column order; exact binary COPY MD5/count, no row logging/files. CLI boundary uses fixed source host/TLS/private captured credentials; Storage GET fixed origin/no redirects and read key RAM only. Complete typed hash-manifest comparator rejects missing coverage, counts/hashes/sequence changes, duplicate keys, incomplete flags and inconsistent object totals. BigInt uses compatible constructor, no assertion/timeout relaxation.

Rehearsal controller targets only two fixed new isolated DBs, forbids collisions/replay/non-staging destination, checks P3/transport/roles and durable intent, preserves owners/ACLs/defaults in atomic native restore. Only original supported owner/ACL normalization and approved unused-CLI expiry alignment are allowed; unrelated schema or any data difference stops without edits/truncation/dedupe/wipe. Data archives/private source manifests/full logs only /opt/ir35/.env*600/ir35. Default scripts/migrate-db.sh --dry-run has no credential/network/write side effects. No production/cutover path is implemented or authorised.

## Test plan

1. Full strict types/lint/Vitest/legacy/Linux helpers/source+dependency scan; focused verify-migration/transport/data fingerprint/storage/source/rehearsal tests. Real catalog SQL runs on disposable PGlite, native ARM row fixture independently checks bytes.
2. Inspect source-only evidence files; expect zeroLossVerified=false and no target PASS. Public fields contain names/counts/hashes only, never paths/credentials/row values.
3. Reviewed fixed-cycle execution uses the private PowerShell wrapper, never passwords/URIs in arguments. Any mismatch or ambiguous target preserves protected evidence and stops; never replay a pending restore.
4. Later test-account login uses anvesh.mannuru+ir35test@gmail.com only, no customers/employers; no UI screenshot/production verification is implied.

Migrations/env/manual: no source migration, production setting or public secret. Source Storage key is transient local RAM only, stripped from SSH child environment. Private Auth/test-account/Google/DNS gates remain owner-only when actually needed. Cutover requires exact YES CUTOVER, absent.
