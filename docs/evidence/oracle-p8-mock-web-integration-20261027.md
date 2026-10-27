# P8 web → durable mock worker → canonical callback: source integration

Status: **SOURCE INTEGRATED; NOT BUILT OR RUN ON ORACLE. P8 INCOMPLETE.**

The earlier component-only checkpoint is preserved. This concern connects the actual app path, not a substitute standalone P6 receipt. All PRs remain draft/unmerged, production remains untouched, and literal YES CUTOVER is absent.

## Source boundaries

| Component | Boundary |
| --- | --- |
| Actual submit route | Mock mode fails closed before real fallback; exact authenticated named account and current server-owned fixture job checked before packet writes. Existing approvals/readiness preserved. |
| Producer | Single cached connection, exact `ir35_queue_producer`, private/pinned queue database only, no migration/supervision; separate queue `ir35-staging-web-mock-apply`; application/job UUIDs + delivery version/time only. Durable publish awaited before202. |
| Canonical app lifecycle | Existing migration025 RPCs; queued/submitting/submitted/failed and events remain authoritative. Duplicate clicks cannot reset a running task. Explicit Retry retains absolute attempt counters. Failed publish commits a visible reason with an exact-attempt guard. |
| Claim/callback routes | Mock handler runs before normal heartbeat/recovery/mail/profile logic. Bounded strict DTO, distinct method/path/body/time HMAC, fixed redacted errors. No CV, email, credential or destination URL leaves the app. |
| Consumer | Separate entrypoint, only minimal queue-owner credential, pool2, one child through existing shared PostgreSQL advisory exclusion. No direct app/Auth/Storage/provider credentials. Supervision and instance registration OFF: old P6 queues/ledger are not maintained by this process. |
| Durable outbox | New `pgboss.ir35_mock_web_delivery`, not a P6 table. Start marker before browser, outcome before callback. Lost ACK repeats the same stored outcome; a crash after start becomes visible unknown failure, never another browser submission. New DDL atomically revokes app/producer privileges, including inherited default grants. |
| Heartbeat/watchdog | Fifteen-second private signed heartbeat. Ten-minute watchdog is restricted to six fixture jobs AND the named account; never invokes the global watchdog on copied customer tasks. |
| Private HTTP | Same unchanged queue all-private resolver, exact operator host and numeric address pinning, no redirects,16KiB/10s bounds; purpose signature but never the key/Basic/Bearer material. Public staging TLS/Basic/SDK/cookie/noindex/no-store unchanged. |

The bridge flag remains false by default. `APPLICATION_WORKER_ACCEPT_JOBS` must stay false; normal `kickApplicationWorker(mock)` remains disabled. The app gets only the producer identity; the consumer never gets the app's Supabase credentials or a producer URL. With the original idle P6 process, owner pools total at most4 and producer pools at most2; actual native connection/memory checks remain required.

## Observed offline checks

- Five component files:74tests PASS13.18s, including real in-memory PostgreSQL ledger/ACL/canonical lifecycle checks and actual loopback HTTP transport tests.
- Actual Next API handlers:4tests PASS4.92s. Submit→claim→callback reaches canonical submitted; employer/alias/provider/notification/recovery/`after` spies remain uncalled. This is not a headed UI or native-runtime proof.
- Full repository before final startup hardening:1,194unit/170files PASS187.17s,199legacy PASS, strict typecheck and full zero-warning lint PASS.
- Final startup/engine focus:20tests PASS4.62s, strict typecheck and changed-source zero-warning lint PASS. Pool-start/browser/ledger/control/listener failures must close the pool without polling; no app table can be reached by queue roles.
- The first source-secret check passed for1,937 tracked files/history. A staged-file/final-source check is still required; untracked files are not implicitly covered.

Preserved offline findings are in the `oracle-p8-mock-web-*-offline-*-20261027.json` files and the typing receipt. The time fixture now advances its own JavaScript clock rather than trying to defeat the real database trigger. Startup fault injection preserves original module exports and uses deterministic listener failure, rather than relying on Windows loopback/wildcard binding behaviour. Original assertions, ten-minute threshold, timeouts, data hashes and catalogues were not weakened. A new unused-parameter lint warning was observed in the focused and already-running full lint commands before one repair; both failures are retained in this report. Subsequent full lint passed.

Source review additionally required fail-closed startup pool cleanup and disabling new global queue supervision before any native activation. These are source changes only; no native gate was consumed.

## Native work still required — no replay or inferred PASS

1. Require final source checks and hosted security green, then build new pinned ARM images on the existing VM only; retain preceding digests. Do not reuse any consumed P5/P6 build/run slot.
2. Fresh, uniquely owned disposable writable QA clone, exact baseline first, then the separately reviewed025 upgrade and explicit upgrade-delta checks. Never migrate or write pristine/P5/cloud. Validate original containment before and after cleanup.
3. Private fixture routing pinned to exact owned containers/build/fixture identity BEFORE login or writes. No public edge/DNS change, no external assets/provider calls, SMTP sink only; Basic/noindex/no-store/SDK401/401/200 preserved.
4. Actually provision/check the separate queue/table ACLs and both queue-role/pg_hba denials against all app/clone databases. Keep all old P6 rows/receipts unchanged. Actual native browser readiness, crash/restart/ACK/watchdog proof and frontend/Realtime state refresh required.
5. Headed UI sign-up/login/recovery/search/detail/save/profile/account/mock-apply QA, followed by full original62counts+orderedMD5/Auth/2sequences/3approved schema exceptions/552privileges+queue-role checks/73StorageSHA/FRESH pg_hba checks.

No VM, image, service, queue row, app row, role, configuration, secret, source-cloud data, provider or production setting was changed by this source work. No real email/employer submission. No new OCI resource or billing proof claimed.

Independent remaining P8/P9 gates: age recipient/offline restore custody and narrow backup IAM owner batch; actual encrypted backup/restore; supported zero-loss managed Cloud Storage reverse path; monitoring/alerts/disk checks; full timed cutover/rollback staging dry-run. Existing read-only load/browser and P7 scoped Auth evidence remain valid but do not stand in for this work.
