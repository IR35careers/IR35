## What and why

End-to-end Phase 0 work, superseding the earlier prepare-only brief. **Draft: do not merge/deploy yet.** No production runner switch is authorized until the owner types **YES CUTOVER**. No real employer submissions are permitted during verification.

- Explain the actual incident with baseline file:line references and authenticated Supabase CLI evidence. The initiating UI event was browser-only; repository persistence omitted it and reload inferred Ready from the legacy packet. The worker subsequently stopped at an Adzuna account gate. No employer receipt exists. Hosting failure is not invented as the cause.
- Add a stored, forward-only lifecycle, version CAS, atomic transition/outcome events and explicit Retry. Preserve recruiting history and receipts. Bind callbacks to monotonic attempt IDs, never replay an unknown expired running attempt, and fail watchdog timeouts with a reason.
- Read stored delivery state in the modal, page and tracker through owner-RLS Realtime/reconnect refresh. Queued is not Submitting. Pipeline counts and actions no longer derive Ready from legacy approvals. Unresolved aggregators are external_only, with an HTTPS employer link.
- Close legacy extension write/export paths: opening an employer page is extension-free and does not start another attempt. Contractor-reported external submissions are explicitly unverified notes, not fabricated employer receipts or Submitted status. Worker-confirmed outcomes remain authoritative.
- Prepare pinned Playwright + pg-boss Railway worker, seven private queues, producer-only Vercel enqueueing behind APPLY_RUNNER, standby health, heartbeat, cancellation, bounded retries and timeout watchdog. Only apply/ingest/existing scheduler handlers are implemented; other queue names are not claims of feature completion.

## Current evidence / remaining gates

- Latest full local release check passes **524 tests/112 files + 199 legacy checks, TypeScript and ESLint**. Fifteen lifecycle SQL/contract cases execute migration 017's real historical grants before 025, including an actual authenticated-role write denial and successful owner CAS save. The historical aggregator backfill distinguishes resolved employer destinations, employer questions and profile gates.
- Release quality `39035317198` and CodeQL `39035317176` are fully green at `6432a79`, including all three browser viewport jobs, production build, security and actual Docker/Postgres standby health. Final migration-review changes must pass CI at their own head before merging; green at the prior commit is not treated as green for new code.
- GitHub run 38731316185 at 1b1d807 passed the production build, repository/history scan and **real Docker build + Postgres queue installation + standby /health**, including Chromium/database readiness. The browser job timed out and exposed stale fixtures plus genuine contrast/hidden-focus problems; corrections remain under verification.
- Run 39031624782 at 414462e passed production quality, worker standby and dependency/repository security. Browser completion remains a release gate.
- Selector-parser is patched to 7.1.6. The owner explicitly approved only two exact advisory/version exceptions through 29 October 2026; see docs/dependency-security.md. They are disclosed residual risk, not zero vulnerabilities. New advisories, versions, malformed results and expired exceptions still block. Registry signatures/attestations remain required.
- Supabase and Vercel CLI authenticated/linked; GitHub CLI authenticated via existing native Git credentials; Railway's fresh native login is verified. No Railway resource, queue role, migration or worker deployed by this follow-up yet. Local Docker installation is explicitly deferred by the owner. Official PostgreSQL client 17.11 is installed in the existing Ubuntu environment for a Docker-free backup path; no database server was installed. PITR is off and no physical backup is available; an encrypted recovery backup remains a release gate.
- The browser reload test uses a mock ATS, actual lifecycle SQL RPC and a labelled preview hydrated from its SQL result. **Live Supabase Realtime and Railway staging matrix are not yet verified.**

## Migrations and rollout safety

- 023 decimal rates was previously user-confirmed and publicly verified. New 024 watchdog and 025 lifecycle are not installed yet. Take a backup/PITR evidence first. No destructive DB operation without separate approval.
- 025 preserves data/history but changes browser write privileges. Coordinate compatible migration/web deployment ordering before releasing; do not let a main-branch Git deploy run before the lifecycle exists or unexpectedly break old clients. This remains an explicit gate.
- `vercel.json` temporarily disables Git deployments on `main`, as well as Railway feature branches, with a regression test. The authenticated Vercel project API confirms `main` is the production Git branch. This permits a reviewed code merge without automatically releasing migration-dependent UI. Existing production stays at `0df1489`; manual release and either runner cutover flag remain separately gated.
- Keep pgboss outside the Data API, owner/producer roles scoped to that schema only, no BYPASSRLS, verified TLS on the real Supabase session pooler port 5432. Setup is a separate operation; runtime cannot migrate queue DDL.
- Do not weaken CSP or tenant RLS. Target worker-only Supabase service-role isolation and normalized target tables remain tracked work; this PR does not pretend those are complete.

## Environment / operations

Every variable is listed in .env.example and docs/deploy-worker.md (names only, no values). Web defaults APPLY_RUNNER=vercel; Railway standby APPLICATION_WORKER_ACCEPT_JOBS=false. Native login/hidden input/stdin only for credentials. Railway: nearest Supabase region, one replica, 1 vCPU/2 GB, no sleep, $30/month alert. Standby deployment is authorized; enabling either production flag requires literal YES CUTOVER.

Agent executes all commands. Owner supplies logins/secrets, dashboard-only choices where necessary, and final approval. Verify the live-worker mock matrix before cutover. Retain the Vercel consumer through the seven-day rollback window and open its removal as an unmerged follow-up PR. No DNS, billing, Stripe, mail-provider or Google branding changes are claimed here.

## Production verification and rollback

Use only anvesh.mannuru+ir35test@gmail.com and a controlled mock ATS. Cover duplicate message, queue unavailable, queued restart, lost callback acknowledgement, expired lease -> runner_timeout, browser cancellation and status after reload. Verify ingestion enqueue returns 202 and that Railway, not Vercel, runs browser work. Observe logs for 30 minutes after approved cutover. Exact cutover/rollback commands are in docs/deploy-worker.md; report actual URLs/regions/env names/results, not presumed success.

## Scope / integration

Stacked on codex/railway-worker-base, the already-deployed release snapshot plus no-deploy branch guard, to avoid mixing earlier SEO changes into review. Main is approximately 290 historical commits behind; inspect/integrate the deployed baseline deliberately before retargeting, not by blindly merging it. All phases 0–7 stay in docs/spec.md and docs/progress.md. Draft remains until code, rollout ordering and staging gates are genuinely satisfied.

Screenshots: existing browser baselines are being reconciled with the already-redesigned page using a version-pinned Chromium, fixed preview time and reduced motion; visual and accessibility checks must pass before release. No screenshot implies live worker readiness.
