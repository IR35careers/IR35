# IR35Careers persistent application worker

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
