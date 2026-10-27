# Queue runtime integration and journal security repair — source proof

This is repository/CI work ONLY, not a new Oracle image or runtime rollout. Live worker remains mock/real-acceptancefalse/SMTP sink. No OCI, IAM/network, role/HBA, VM/env/secret, DNS, source-cloud, Vercel, Google or production change.

## Runtime integration gap and repair

P8 readiness inspection found the prepared `queueDatabaseConnection` validator was used by the isolated mock lane, but normal `producer.ts`, `setup-queue.ts` and `railway.ts` still called the legacy Supabase-only synchronous builder. The validator's old pure matrix even explicitly labelled its wrapper as awaiting callsite integration. P6's mock PASS did NOT prove this normal runtime path could connect to self-hosted Postgres; no broader claim is made.

All THREE executable normal paths now await `queueRuntimeOptions`, delegating to the same unchanged exact-host/TLS/private-DNS validator. Exact operator allowlist, all-address private resolution, numeric-IP pinning, verified public/Supabase TLS, credential-safe errors, port5432/databasepostgres and query-parameter stripping remain enforced. No implicit runtime loopback bypass from test flags. CI setup/standby gives ONLY its disposable loopback host an explicit non-secret allowlist. The old synchronous builder/permission-probe tests stay intact as compatibility coverage, not a normal runtime escape hatch.

Mode policy is shared rather than forked: same schema, producer pool1/other4, timeouts, createSchemafalse, setup-only migrations, worker-only supervision/registration, schedulerfalse,15s heartbeat/monitoring and original queue/retry semantics. Supabase runtime options compare exactly equal to the old builder. Runner selection, enabled/acceptance, concurrency and maintenance gates are UNCHANGED. In particular, mock still cannot kick the real producer; do not switch to oracle or enable acceptance just to make a QA case pass.

The normal producer validates before constructing pg-boss; invalid/public/mixed-DNS/wildcard inputs create no DB client and publish nothing. Third-party constructor, publication and shutdown failures are redacted without connection strings or candidate values; ambiguous teardown never invents submission success. Each process must receive its own least-privilege queue identity; no owner URL is copied into the web producer.

## Journal CodeQL finding, retained and repaired offline

Original check122094228606/high `Potential file system race condition` at the previous controller line26 is preserved in [the immutable finding](oracle-p8-codeql-journal-race-20261027.json). Path metadata was checked before reopening that path for content. No actual artifact/data/privilege mismatch was observed; the finding still blocked further Oracle native work.

Repair1 retains the descriptor from each exclusive `wx+` creation until sealing/disposal, reads/hash only positional bytes from that OWNED descriptor, verifies fstat/lstat device/inode/type/linkcount before and after, bounds/exhausts the file and closes every handle. A swapped path cannot redirect the content read. This follows [CodeQL's descriptor recommendation](https://codeql.github.com/codeql-query-help/javascript/js-file-system-race/), not a suppression. The real filesystem regression moves the owned artifact OUTSIDE its journal but inside its validated public-temp fixture, replaces the original path, and requires the specific identity failure (not merely an extra-file failure). Tamper/replay/closed-slot assertions remain, no migration verifier, data hash, catalogue, privilege or timeout edits.

## Actual local verification

- Strict TypeScript + zero-warning full lint PASS.
- Final full release suite: **1097 unit tests/163 files PASS,139.94s;199 legacy checks PASS**.
- Focused actual-runtime/boundary/legacy/mock/journal group:118PASS across5files.
- Existing Python helper609fresh-home PASS remains the preceding browser-source proof; no Python/helper change in this task, no fresh helper/native claim substituted.
- Real PgBoss constructor matrix + mocked-driver producer wiring prove accepted configuration and call order, NOT a live Oracle normal-worker connection. Existing AMD64/nativeARM CI setup, separate-role permission and standby/drain-resume jobs must pass on the pushed head; both retain acceptancefalse/no candidate credentials. Fresh hosted CodeQL must pass before Oracle native work resumes.

P8 remains INCOMPLETE: isolated writable frontend/Auth/mock-apply integration, actual encrypted backups/restore, exact managed-Storage reverse path, monitoring and timed drills. The public read-only browser gate remains its original sealed PASS, not replayed with this source. Backup key/IAM owner batch is unchanged. P9 remains preparation/NO-GO only; no exact YES CUTOVER.
