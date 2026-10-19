# Safe pull-update prerequisite: authenticated worker drain

## What and why

Prepare the owner's approved outbound Oracle updates without enabling them. A zero active snapshot is racy; all application/ingestion/scheduler pollers must stop, in-progress fetches and actual callbacks must settle, and a new database read must show no running application before a replacement is safe. Track callbacks beyond pg-boss overrun acknowledgements. Version health reads so stale success/zero cannot override newer reads or database errors.

POST /maintenance uses bounded JSON, operation UUID, a 30-second domain-separated HMAC and fixed redacted failures. Drain/resume are idempotent per current operation; resume during unfinished drain is armed rather than starting duplicate consumers. Standby never calls consume/stop ports. This is temporary in-memory polling state, not a mutation of acceptance or APPLY_RUNNER. Failed transitions stay unsafe. Only loopback health/control is exposed by Oracle Compose.

## Verification

Unit tests cover auth/schema/UTF-8 limits/skew/domain separation, actual Node loopback HTTP responses, callback overruns/late fetches, duplicate/conflicting commands, busy abort/resume, standby, failures, stale/out-of-order/expired database reads. Full pre-description-merge source: 802 unit tests/131 files, 199 legacy checks, TypeScript/ESLint pass. Native ARM CI adds an actual isolated-container drain/resume probe; final-head CI is required before merge. No real employer or candidate fixture. No UI change; screenshots not applicable.

## Migrations, environment and manual gates

No dependency, migration, RLS, CSP or new env variable. Reuses APPLICATION_WORKER_SECRET only on authenticated loopback control, with a separate signature domain. No worker/registry/Oracle deployment, firewall, Railway or cutover changes. Oracle activation, queue roles, compatible migration/web release and real standby verification remain open. Publisher, host updater, timers and rollback driver remain separate unfinished work; do not infer their existence from the drain protocol.

## Production verification

Do not exercise this against an active employer submission. After actual Oracle signup/free-resource/secrets gates, verify standby over owner-only SSH with APPLY_RUNNER=vercel and APPLICATION_WORKER_ACCEPT_JOBS=false, then the controlled mock ATS/test account anvesh.mannuru+ir35test@gmail.com only. No acceptance or production runner change without literal YES CUTOVER. No paid plan/add-on.
