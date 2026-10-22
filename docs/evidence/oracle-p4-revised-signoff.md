# P4 PASS — owner-revised acceptance a–f,21October2026

Draft [PR53](https://github.com/IR35careers/IR35/pull/53), unmerged. No production/cloud writes, Vercel, DNS, Google, real-mailbox, IAM, resource/plan/cost or cutover changes. No further attempt used the real account password. Original failed journals/counters remain intact.

Authoritative [write-once signoff](p4-recovery/p4_20261021T170139Z_8be0fc2e/revised_signoff.json), manifest SHA256 `6043fd966060f0b69b72f0237d984aa49245440f941e2600b7818091ede8c2df`. This is the owner's explicitly revised P4 gate, NOT production/migration release approval.

| Owner criterion | Actual result |
| --- | --- |
| a. Synthetic Kong password/refresh/authenticated RLS | PASS, earlier immutable synthetic-2.json; same shared password-grant harness |
| b. Every Auth password hash matches the cloud snapshot | PASS, all147users covered by cloud-bound whole-row fingerprints plus fresh-clone per-user md5(encrypted_password) equality; values never printed |
| c. Named account and identities field-for-field | PASS, complete user row and1identity row match before any fixture mutation; values/hashes not printed |
| d. Sink recovery/new-password/login/refresh/RLS/revocation | PASS, mail-3.json; prior session deleted and old refresh rejected; current recovery session retained per pinned GoTrue contract |
| e. Sink magic link | PASS, actual OTP request, captured sink link exchange, signed JWT/user endpoint, positive own-profile RLS and cross-owner/anon negatives |
| f. Full snapshot verification | PASS, all62table counts/ordered MD5 incl27Auth/password bytes;2sequences, UTF8/collation/Unicode,3752schema objects/0unexplained differences/ONLY3approved extension-owner fields,327supplemental objects,552privileges and73Storage files/bytes/SHA256/API/signedURLs |
| Verified rehearsal DB unchanged; disposable Auth test destroyed | PASS, full pristine before/after fidelity; exact annotated fixture database dropped/read-back absent,4owned containers removed |

## Snapshot binding and safe recovery

All comparisons bind to run `p4_20261021T170139Z_8be0fc2e`'s NEW read-only cloud snapshot and verified pristine DB, not moving live cloud rows. Full-row ordered fingerprints prove all source fields including each password hash. Per-user password projections and complete named-user/identity projections are then compared in RAM between that verified pristine source and the new exact template clone. No individual password hash, identity field, token, recipient message body or customer row is published. No cloud credential/reset/login was used.

Every Auth rehearsal used a fresh `_mail1`/`_mail2`/`_mail3` clone from that verified source. Before Auth mutation, all62tables/schema/security pass. Only the disposable fixture receives magic-link/recovery/session/password writes. Dedicated pinned Mailpit is RAM-backed (`/tmp` tmpfs), read-only root, internal-only network, no published ports/relay/provider credentials; exactly2messages in the passing run, no delivery route to a real inbox. URLs are strictly parsed to the staging API origin/path, then their tokens exchanged through the private Kong `/auth/v1/verify` endpoint; no external link is followed. New random password is generated only in RAM, submitted once through the SAME password-grant construction as the synthetic test, never written/logged; only its temporary bcrypt representation exists in the disposable DB, which is destroyed.

Actual magic-link session existed before recovery. Updating the recovered user's password removed that prior session, and its refresh token was rejected. The current recovery session remains as intended by [pinned GoTrue password-update implementation](https://github.com/supabase/auth/blob/v2.197.0/internal/models/user.go#L407). Already-issued stateless access JWTs expire by their TTL; no claim of instant global JWT invalidation or cloud-side reset test. Subsequent new-password session, actual refresh, own-profile read, cross-owner/anonymous denials and logout all passed.

## Bounded self-heal and cleanup

All failed stages remain sealed, not relabelled PASS. Mail1: parser expected64hex; [pinned token implementation uses SHA-224/56hex](https://github.com/supabase/auth/blob/v2.197.0/internal/crypto/crypto.go#L42). Fixed the parser to the EXACT pinned format, preserving strict origin/path/type/recipient checks, fixture test added. Mail2: magic link passed, immediate recovery returned429/over_email_send_rate_limit. [Pinned GoTrue shares the recovery timer with magic links](https://github.com/supabase/auth/blob/v2.197.0/internal/api/mail.go#L453); default1minute. Fixed the harness to wait65seconds in bounded intervals, NOT change config, edit timestamps or retry the denied request. Final permitted mail3 PASS; no fourth attempt.

Each of all3runs stopped/removed4owned containers and dropped ONLY its exact named/owner-annotated disposable DB with no active connections, then verified absence and full pristine fidelity. All3cleanup flags PASS. Operational env artifacts and failure/success manifests remain private/hash-bound for evidence; Mailpit tmpfs and disposable database are gone. The pristine rehearsal DB, historical denied fixture and original incident artifacts were never destroyed or modified.

Passing mail manifest SHA256: `e5f342b22ba5e83b58a44926185808632c9315b4b179990b20ece963935b5cee`. Prior FAIL manifests: mail1 `2fd8f4fd90ab11871b6993d076d321547ab4f6e853c70e7b6a156d9cc07b5d2c`; mail2 `f3ad871f1a970d88eea564673f29de3c5bfaeb2af4be965640ef4614300a5b83`.

Final local checks PASS:258Linux helper tests,946Vitest/149files,199legacy, strict types/full zero-warning ESLint, hidden-launcher PowerShell parser, whitespace/source-history and dependency audit (only the two existing owner-approved exceptions through29October). One cold WASM initialization caused the first full-suite test to exceed its existing5s limit; moved ONLY database construction/waitReady into beforeAll, matching the already-stable transport test. No assertion/SQL/timeout/worker count changed; full release rerun PASS119.33s. New draft-head hosted CI is separate, not claimed PASS.

## Original denial classification and next phase

As explicitly decided by the owner: **“user-entered password did not match the cloud hash; not a migration defect”**. This classifies the recorded invalid_credentials attempt; its400, correlated logs, consumed slot and global attempt count2 remain immutable. The original password was not recovered/retried or printed. The current acceptance relies on byte-identical hashes/rows plus actual synthetic and recovery authentication, not an invented original-password login PASS.

P5 starts automatically in a separate draft PR: standalone ARM app, portable adapters, maintenance/health and SEO staging fixes. Still REQUIRED BEFORE CUTOVER: end-to-end timed migration/reverse-sync rehearsal/guarded wipes, P5–P8 app/worker/provider/load/backup/restore tests, human review and exact **YES CUTOVER**. Earlier “two complete cycles/reverse” work is still open, not silently declared passed by this revised Auth gate. Source projects/providers and production remain intact.
