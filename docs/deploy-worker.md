# Railway worker deployment runbook — prepared, NOT deployed

Execution authority update: the owner's later end-to-end Phase 0 brief now authorizes the agent to run these setup and **standby** deployment commands, collecting native login/hidden secret input only when needed. The owner must not be asked to run commands. Dashboard-only actions are described for the owner and then awaited. Do not change web APPLY_RUNNER or enable worker ACCEPT_JOBS until the owner explicitly types **YES CUTOVER**. Preserve a seven-day rollback window and open—but do not merge—the consumer-removal PR. Migration **025_application_delivery_lifecycle.sql** must be installed and tested before the new web lifecycle code is deployed; it strengthens browser write access and is additive. The earlier owner-run wording below is a reference command inventory, not a current request for the owner to execute it.

Owner decision, 15 October 2026: Railway, existing Supabase Postgres, pg-boss in private `pgboss`, **session pooler port 5432**, one replica starting at **1 vCPU / 2 GB RAM**. No Railway resource was created, no secrets added, no production runner switched by this change.

Local verification: TypeScript, ESLint, 486 Vitest tests and 199 legacy checks passed; six Playwright tests used controlled mock ATS responses only. Production Next build passed. The real pg-boss constructor accepted the settings, but no authenticated Postgres integration or Docker build was possible locally. That distinction is a release gate, not a claim of live readiness. Review [draft PR #1](https://github.com/IR35careers/IR35/pull/1); it is not a completed Phase 0 incident resolution.

## Verified release hold — 17 October

Vercel's authenticated project API confirms `main` is the production Git branch. `vercel.json` temporarily disables Git-triggered deployments on `main` and `codex/railway-*`. This separates the authorized code merge from a production release. Do not remove the hold until the recovery backup, lifecycle migration/rolling-client compatibility and reviewed web-release gates are satisfied. Manual CLI deployments remain possible but must not precede migration 025. The hold does not stop or alter the currently deployed site, change either runner flag, or authorize cutover. After the coordinated web release is verified, remove `main: false` and its temporary regression test in a reviewed follow-up.

Fresh native Railway login is verified; its account currently has no projects. Docker Desktop installation is explicitly deferred by the owner. The real pinned Chromium Docker/Postgres standby CI job passes; local Docker installation is not claimed. Supabase reports PITR disabled and no available physical backup: database changes remain gated on a verified recovery backup. All six focused production-mode browser regressions pass across the three viewports; final full CI is still required.

Final-head CI subsequently passed at `41148a0` (Release quality `39036142240`, CodeQL `39036142243`); PR #1 is merged as `bca7288`. Vercel still serves `0df1489`, so merging did not deploy the migration-dependent code. Operations continue on `codex/railway-deployment-ops`. The owner requires the verified portable encrypted backup described in [pre-migration-backup.md](pre-migration-backup.md) before any migration. Neither production runner flag has changed.

## What is prepared

- `services/application-worker/Dockerfile`: pinned `mcr.microsoft.com/playwright:v1.61.0-noble`, matching installed playwright-core, non-root pwuser, explicit source COPY and `.dockerignore` excluding credentials/local output.
- Root `railway.toml`: Docker build, `/health`, bounded startup healthcheck, ON_FAILURE restart policy, one replica, no sleeping.
- pg-boss 12.38.0, schema fixed to `pgboss`; verified TLS; only Supabase session-pooler URLs on 5432 accepted. Producer connections are short-lived/max one, no schema installation or worker timers in Vercel. Worker pool max four.
- `APPLY_RUNNER=vercel|railway` defaults to vercel; unknown values fail closed. Railway mode routes apply kicks and ingestion/automation crons into Postgres. The old Vercel consumer forwards any residual deliveries to pg-boss rather than opening another browser.
- Worker starts in **standby** (`APPLICATION_WORKER_ACCEPT_JOBS=false`): checks Chromium and queue/database readiness but does not claim applications or run scheduler/ingestion handlers. `/health` returns 503 on startup, shutdown or stale/failed DB health.
- Active job heartbeats refresh every 15s. Queue heartbeat expiry is 60s; absolute queue-job expiry ten minutes; two transport retries. An expired application lease is NOT silently replayed: migration 024 records a ten-minute `runner_timeout` and stops for explicit review. Callback retries reuse the same result; no second browser invocation inside that handler.
- Queues: apply, ingest, enrich, match, tailor, mail, alerts. This slice consumes **apply, ingest and the existing automation scheduler command on alerts**. Remaining queue handlers are intentionally unregistered until their phases are implemented; do not publish those workloads yet. Mail/webhook and interactive tailoring are not migrated by this PR.

## Environment variables

See root `.env.example` for every supported worker setting and its default. Never copy a local `.env` into the image, commit secret files, paste credentials into chat, or use `NEXT_PUBLIC_` for a secret.

| Variable | Where / purpose |
| --- | --- |
| `APPLY_RUNNER` | Web defaults to vercel; worker requires railway. Switch web only at cutover. |
| `PG_BOSS_DATABASE_URL` | Both. Use Supabase **Session pooler**, actual regional host, port 5432/database postgres; percent-encode password. Never transaction pooler 6543. |
| `PG_BOSS_SSL_CA` | Both, optional trusted certificate PEM if required by project's CA chain. Verification is never disabled. |
| `PG_BOSS_LOCAL_TEST` | CI only, never production. Loopback Postgres without TLS is accepted only when both NODE_ENV=test and this flag=true; every production connection still requires the verified-TLS Supabase session pooler. |
| `APPLICATION_WORKER_SECRET` | Both, same existing HMAC secret, at least 32 characters; approved-packet/callback API authentication. |
| `IR35CAREERS_APP_URL` | Worker, canonical HTTPS origin, normally https://www.ir35careers.com. |
| `APPLICATION_WORKER_ACCEPT_JOBS` | Worker, false during staging; true only after approved cutover. |
| `APPLICATION_WORKER_CONCURRENCY` | Worker, 1 initially (validated maximum 2 for this small container). |
| `APPLICATION_WORKER_VERSION` | Worker, release identifier for private heartbeat diagnostics. |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Active worker: private task lease checks, watchdog, heartbeat, ingestion and scheduler. Public URL is not secret; key is. |
| `CRON_SECRET` | Active worker: same >=32-character scheduler signing secret as Vercel. |
| `JOB_DECIMAL_RATES_ENABLED` | Worker ingestion, true only with migration 023 installed. |
| `REED_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Optional ingestion. Without them those feeds are skipped, not invented. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Optional existing evidence-safe field-label mapper. No key required for deterministic forms. This is not yet the spec's replacement OpenAI service. |
| `APPLICATION_RUNNER_ALLOWED_HOSTS` | Optional narrower employer host allowlist. Existing public HTTPS/SSRF checks always apply. |
| `AUTO_APPLY_DAILY_BATCH_LIMIT` | Scheduler, default 25, bounded 1–25 by existing code. |
| `PORT` | Railway-injected port; local default 8787. |
| `NODE_ENV`, `PLAYWRIGHT_BROWSERS_PATH` | Image defaults production and /ms-playwright. |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | Set 330, allowing the worker's bounded graceful stop. |

Do NOT add Stripe, Google OAuth, mail-provider or Supabase anon keys to this worker just to make unrelated features appear connected. Existing signed web APIs still handle CV approval, OTP lookup and callback persistence. The target's worker-only service-role architecture and unified application state machine remain separate work; this preparation does not claim they are complete.

## 1. Prepare database (owner, before any consumption)

1. Back up and run `supabase/migrations/024_railway_worker_watchdog.sql` in Supabase SQL editor. It creates the private schema and a service-role-only timeout RPC; it does not run the watchdog or requeue applications on installation.
2. Keep `pgboss` OUT of Supabase Data API exposed schemas. Do not grant queue access to anon/authenticated or change public-table RLS.
3. Create a dedicated queue login/owner with a strong generated password in the database administration UI. Give it ownership/CREATE of **pgboss only**, not ownership of public/auth/storage, and no BYPASSRLS. Copy its regional session-pooler connection string. Use a separate producer login for Vercel where practical.
4. With the queue-owner URL in a private local environment, run setup once from the repository root:

```powershell
npm ci
node --env-file=.env.worker.local --import tsx services/application-worker/setup-queue.ts
```

The private file needs only `PG_BOSS_DATABASE_URL` and optional `PG_BOSS_SSL_CA`. `.env.worker.local` is ignored. Setup installs pg-boss into the pre-created schema and all seven queues. Runtime `migrate=false` means deployment cannot silently upgrade queue DDL. Keep schema owner and pinned pg-boss version aligned; test future migrations separately.

If the schema was created under postgres by SQL editor, an owner must `ALTER SCHEMA pgboss OWNER TO <queue_owner>` before setup. Do not use a PostgREST API key as a database password. For a separate producer role, after installation grant schema USAGE and SELECT/INSERT on pg-boss tables (plus USAGE/SELECT on its sequences if present); test `start`/`send` with that role. Do not grant it access to public candidate tables. Never expose SQL editor/browser credentials to clients.

## 2. Connect Railway — exact owner-run CLI steps

These are instructions, **not commands already executed**. Use the repository root as Railway's build root, not the services subdirectory, because package-lock and src are shared.

```powershell
npm install --global @railway/cli
railway --version
railway login
railway link --project YOUR_EXISTING_PROJECT_ID --environment production
railway add --service ir35-worker
railway link --project YOUR_EXISTING_PROJECT_ID --environment production --service ir35-worker
railway variable set APPLY_RUNNER=railway APPLICATION_WORKER_ACCEPT_JOBS=false APPLICATION_WORKER_CONCURRENCY=1 IR35CAREERS_APP_URL=https://www.ir35careers.com RAILWAY_DEPLOYMENT_DRAINING_SECONDS=330 --service ir35-worker --skip-deploys
```

Add secrets yourself in Railway Variables (sealed where supported). If using CLI, feed each value over stdin, with no `KEY=secret` argument or secret-bearing output. Example PowerShell secure prompt:

```powershell
$queueCredential = Read-Host 'Session-pooler connection string' -AsSecureString
[System.Net.NetworkCredential]::new('', $queueCredential).Password | railway variable set PG_BOSS_DATABASE_URL --stdin --service ir35-worker --skip-deploys
$queueCredential.Dispose()
```

Repeat for the HMAC, Supabase server and cron secrets as needed. Do not use `railway variable list --kv/--json` in shared logs: those outputs can expose secrets.

Before deployment, in Railway **Settings > Deploy > Replica Limits**, set **1 vCPU and 2 GB RAM**, one replica, choose a region near the existing Supabase database, and keep **Serverless/App Sleep off**. CPU/memory limits are dashboard settings, not fictional railway.toml keys. Set a spend alert/limit appropriate to your account. Do not add a new Railway Postgres service.

## 3. Owner-triggered standby deploy and verification

Do this only when ready to incur hosting usage:

```powershell
railway up --service ir35-worker
railway logs --service ir35-worker
railway domain --service ir35-worker
```

Check the generated service domain's `/health`: HTTP 200, mode standby, browserReady true and databaseReady true. Readiness tests a real Chromium launch and queue read, not just a listening port. No employer application should start in standby. Railway checks health at deployment, not continuously; add external uptime monitoring for `/health` if desired.

Run repository tests, then verify staging with a **mock ATS only** using `anvesh.mannuru+ir35test@gmail.com`. Test duplicate messages, queue unavailable, restart while queued, lost callback ack, expired lease -> runner_timeout, and browser cancellation. Docker build/live Supabase queue behavior must be verified on a machine with Docker and database access; neither was available for this local preparation.

## 4. Cutover — do not do before standby is healthy

1. Drain/observe existing Vercel applications; don't disable an in-flight consumer midway through final submission.
2. In Vercel, add producer `PG_BOSS_DATABASE_URL`/CA and keep existing worker/submission gates and HMAC secret. Set `APPLY_RUNNER=railway`, deploy the reviewed web code. New kicks/crons now only enqueue; residual Vercel deliveries are forwarded.
3. Enable worker consumption yourself:

```powershell
railway variable set APPLICATION_WORKER_ACCEPT_JOBS=true --service ir35-worker --skip-deploys
railway redeploy --service ir35-worker
```

4. Verify mock application receipt and persistent UI status after reload; inspect private worker heartbeats/events. Verify ingestion cron returns 202 and container logs show execution; no native browser runs in Vercel. Only test real employers outside tests with explicit contractor approval, not as infrastructure verification.
5. Once pending Vercel messages are drained and Railway is verified, remove `/api/queues/applications` and its `experimentalTriggers` entry in `vercel.json` in a separate cutover PR. **They deliberately remain in this preparation** so rollback is possible. Retain `APPLY_RUNNER` and old code until the rollback window closes.

## Rollback

Stop new Railway claims (`APPLICATION_WORKER_ACCEPT_JOBS=false`, redeploy; let active work finish), inspect receipts/unknown outcomes, then restore web `APPLY_RUNNER=vercel` and redeploy. Use the existing reconciliation to republish still-queued application IDs, not to blindly resubmit failed/unknown outcomes. Do not delete pg-boss rows/schema or historical applications as a rollback. Ingestion/automation queued during a rollback need deliberate replay/deduplication; don't run both schedulers concurrently.

## Primary references checked

[Railway configuration](https://docs.railway.com/config-as-code/reference), [CLI deployment](https://docs.railway.com/cli/deploying), [variables/stdin](https://docs.railway.com/cli/variable), [healthchecks](https://docs.railway.com/deployments/healthchecks), [replica limits](https://docs.railway.com/pricing/cost-control), [Supabase pooling](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits), [Playwright images](https://playwright.dev/docs/docker), [pg-boss API](https://github.com/timgit/pg-boss/tree/master/docs/api).
