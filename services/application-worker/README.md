# IR35Careers persistent application worker

## Prepared replacement: Railway (not deployed)

The owner selected Railway with pg-boss on the existing Supabase session
pooler (5432). The Dockerfile now starts `railway.ts` in standby by default.
Use [`docs/deploy-worker.md`](../../docs/deploy-worker.md) and root
`.env.example` for setup, secrets, 1 vCPU / 2 GB limits and staged cutover.
Do not use the legacy standalone environment block below for the new image.
`APPLY_RUNNER=vercel` remains the web default; no production switch is made
by preparing these files. `server.ts` is retained for legacy development.

## Production: managed cloud queue

The production application runs approved tasks on Vercel Queues and hosted
Chromium. A contractor or administrator does not need to keep any laptop,
phone, browser, extension or local worker running. The consumer is declared
in `vercel.json` at `src/app/api/queues/applications/route.ts` and is private
to Vercel's queue infrastructure.

Approval publishes an ID-only event before the API responds. Delayed email
checks use durable queue delays, not sleeping website requests. Failed
invocations are redelivered after the SQL lease expires; completed or paused
tasks are acknowledged without resubmitting. Existing daily automation also
reconciles persisted tasks to repair a database/queue publish gap.

Queue payloads contain no candidate evidence or credentials. The consumer
uses the existing HMAC claim/callback APIs and approved packet. It requires
the normal application-worker secrets on Vercel, but no third-party browser
plugin or separate hosting account. Idle cloud consumers do not emit a
continuous heartbeat; admin distinguishes event-driven execution from an
offline external worker.

The signed drain endpoint can enqueue `reason: cloud_runner_verification`
without an application ID to test the controlled IR35Careers portal. Results
are recorded separately as `cloud_worker_verification`, never as customer
applications. Confirm the recorded receipt before disabling a legacy local
worker. Employer CAPTCHA/account checks still cannot be bypassed.

The standalone service and Windows instructions below are retained for
development and optional external hosts, not as a production requirement.

This service owns the long-running browser session used after a contractor
approves an application. It is separate from Vercel so multi-step employer
forms, account creation and email verification are not cut off by a website
request timeout.

The worker never invents candidate information, bypasses CAPTCHA or marks an
application as submitted without detecting employer confirmation. Missing
answers and protected security steps are returned to the same application as a
precise `Needs you` action.

## Build and run

Build from the repository root so the Docker image can access the shared
application code:

```bash
docker build -f services/application-worker/Dockerfile -t ir35careers-application-worker .
docker run --rm -p 8787:8787 --env-file services/application-worker/.env ir35careers-application-worker
```

The health endpoint is `GET /health`. A production container host should keep
at least one instance running and restart it automatically.

## Worker environment

```dotenv
IR35CAREERS_APP_URL=https://www.ir35careers.com
APPLICATION_WORKER_SECRET=use-the-same-random-32-plus-character-value-as-vercel
APPLICATION_WORKER_CONCURRENCY=2
APPLICATION_WORKER_POLL_MS=30000
APPLICATION_RUNNER_BUDGET_MS=300000
APPLICATION_WORKER_VERSION=production
OPENROUTER_API_KEY=optional
OPENROUTER_MODEL=optional
```

The worker does not receive a Supabase service-role key. It claims work,
checks application-specific email codes and returns results through HMAC-signed
IR35Careers endpoints. Candidate records and encrypted browser sessions remain
inside Vercel and Supabase.

## Vercel environment

```dotenv
APPLICATION_WORKER_ENABLED=true
APPLICATION_WORKER_URL=https://your-worker-host.example # optional for a polling-only local worker
APPLICATION_WORKER_SECRET=the-exact-same-value-used-by-the-worker
PORTAL_SESSION_SECRET=use-a-stable-random-32-plus-character-value
APPLICATION_ACCOUNT_SECRET=use-a-separate-stable-random-32-plus-character-value
```

Apply `supabase/migrations/020_application_worker_tasks.sql` before enabling
the worker. If the worker settings are absent, the existing short hosted
runner remains the safe fallback.

For a free first deployment, the worker can run on an always-on Windows or
Linux computer without a public URL. It polls Supabase and records a heartbeat
that appears in the admin system map. A public `APPLICATION_WORKER_URL` is only
needed for an external host health check and wake-up support.

## Persistent Windows installation

Build the worker and validate its browser and environment before registering
the watchdog. Run these commands from the repository root in PowerShell:

```powershell
npm run worker:build
powershell -NoProfile -File scripts/run-application-worker.ps1 -ValidateOnly
powershell -NoProfile -File scripts/install-application-worker-task.ps1
Start-ScheduledTask -TaskName "IR35Careers Application Worker"
powershell -NoProfile -File scripts/status-application-worker.ps1 -Json
```

Run the installer again after changing the task setup. Updating source files
does not update a previously registered Windows task. An old registration
may still launch Node directly with only a logon trigger; if it stops, it has
no periodic trigger to restart it. The current registration launches the
watchdog at logon and has a five-minute recovery trigger. It runs under the
current user's interactive session, so the machine must remain powered on
with that user signed in. A container host with automatic restart is the
appropriate deployment for uninterrupted service across desktop shutdowns.

The watchdog uses the installed Chrome or Edge and the configured health
port. `-ValidateOnly` checks the configuration without starting or stopping
any processes. The status script reports whether Windows has the current
watchdog registration, whether the health endpoint responds, and whether
the last successful production API connection is recent.

## Reading submission outcomes

The local `/health` `completed` counter means the production API accepted a
worker callback. A callback may have paused for contractor action, cancelled
an expired vacancy, queued another attempt, or submitted the application.
The `failed` counter reports callback delivery failures. Neither counter is
an employer-delivery total.

The additional `tasksProcessed`, `submitted`, `needsUser`, `cancelled`,
`processing`, and `duplicateCallbacks` health fields separate the outcomes
returned by the production API. They are per-process counters, reset on a
restart, and may include repeated attempts of the same application.

Use persisted `application_submissions` outcomes to report delivery:
`succeeded` with a submitted provider receipt is confirmed by the employer
workflow. Contractor-attested completion must be shown separately. A
`processing` submission or a worker task marked `needs_user` is still pending
and must never be included in the employer-confirmed total.

## Operational guarantees

- Each user and application has one idempotent queue item.
- Expired leases are reclaimed automatically.
- A task is attempted no more than five times.
- Worker callbacks are HMAC signed and accepted only by the IR35Careers origin.
- The worker never receives the Supabase service-role credential.
- Application-specific email aliases keep verification codes and employer
  replies attached to the correct contractor and role.
- Candidate evidence is read from the existing secured profile and approved
  packet tables. It is not copied into the queue.
- Employer confirmation is required before the application becomes `Applied`.

Cloud-hosted browsers can still be blocked by an employer, job board or
security provider. Those checks are not bypassed. The application remains
saved and the contractor receives one specific continuation action.
