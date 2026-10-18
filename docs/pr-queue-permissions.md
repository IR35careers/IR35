# Separate-role pg-boss rollout verification

## What and why

The original worker container CI used PostgreSQL's administrator login. It proved Chromium/database standby health but did not prove the requested separation between the private queue owner and the Vercel publisher. This follow-up installs pg-boss as `ir35_queue`, checks a second TCP login as `ir35_queue_producer`, and boots standby with the queue-only owner.

Operational SQL grants the producer USAGE, SELECT/INSERT, sequence USAGE/SELECT and only the clock function's EXECUTE. Browser/PUBLIC access is revoked; future objects inherit the restricted defaults. Neither login owns or reads candidate schemas. Tests catch accidental producer UPDATE authority and owner-identity reuse, rather than silently accepting a broadly privileged connection.

## Verification

- Full release verification, focused role regressions, production build and final-head CI results are recorded in `docs/progress.md`.
- Embedded PostgreSQL runs the actual pinned pg-boss construction/query SQL and operational grants with distinct session identities.
- Docker CI uses two real TCP logins, all seven queues, actual publish/claim/complete, negative mutation/consumption/DDL/role/private-data probes and future-object defaults, followed by the pinned Chromium standby health test.
- The destructive probe refuses production mode, a missing local-test gate and non-loopback URLs without logging credentials.
- No employer submissions or real candidate records are involved. No visual change; screenshots are not applicable.

## Migrations and environment

No production DDL or migration has run. `supabase/operations/pgboss-producer-grants.sql` is explicit operational ACL setup **after** queue installation, not an automatic migration. Roles/passwords are created privately after the owner's verified-backup gate. Published fixture passwords belong only to the disposable CI service database.

`PG_BOSS_PRODUCER_TEST_DATABASE_URL` is CI-only. No new deployed secret or worker variable is required. Runtime `PG_BOSS_DATABASE_URL` continues to use separate owner/producer URLs; URL validation and certificate verification are unchanged. No public RLS policy or CSP is weakened.

## Manual/production gates

The agent runs commands; the owner only supplies native hidden credentials/dashboard-only settings and final approval. The encrypted pre-migration backup remains unverified because passphrase validation failed before export. Do not apply migrations, create hosted roles/queues, or run destructive CI probes on Supabase. After a valid backup, inspect installed production roles/ACLs and test mock queue work for `anvesh.mannuru+ir35test@gmail.com`, never an employer. Hosted staging remains a separate gate.

The Vercel Git deployment hold is retained. `APPLY_RUNNER=railway` on Vercel and `APPLICATION_WORKER_ACCEPT_JOBS=true` still require literal **YES CUTOVER**, not received. This PR does not deploy, change flags or authorize a cutover.

## Rollback

Before hosted installation, reverting this follow-up only reverts CI/operational preparation; the current live release is unchanged. After hosted installation, restore only a reviewed, previously captured private queue ACL if necessary; never grant administrator/public access as a workaround or drop roles/data without separate authorization. Preserve the existing seven-day Vercel consumer rollback window.
