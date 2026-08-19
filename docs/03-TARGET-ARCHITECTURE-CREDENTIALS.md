# Target architecture and credential gates

## Architecture

```text
Next.js public and member UI
  -> typed route handlers / server actions
    -> domain services
      -> Supabase repositories
      -> job-source provider adapters
      -> notification provider adapter
      -> deterministic CV analysis and export service
      -> optional AI provider adapter (disabled by default)
      -> application provider adapters (dry-run by default)
    -> audit events, metrics and error reporting
```

## Data boundaries

- **Public:** active job summaries, reviewed resources and aggregate counts.
- **User-owned:** profile, CV metadata, private CV versions, saved jobs, alerts, application packets and preferences. RLS key: `auth.uid()`.
- **Sensitive:** CV files, application answers, email content and provider tokens. Private storage, minimum retention and audited access.
- **Operational:** source runs, deduplication decisions, provider errors and idempotency keys. Server/service-role only.

No team or employer tenancy should be implied until an organisation/member schema and tenant-isolation tests exist.

## Provider contracts

Each external provider implements a narrow interface with timeouts, rate limits, typed errors, health status and a feature flag. Automated tests use fixtures or sandboxes.

- `JobSourceProvider.listJobs(cursor)`
- `NotificationProvider.send(template, recipient, idempotencyKey)`
- `ResumeProvider.analyse(document, job)`
- `ApplicationProvider.prepare(packet)` and `submit(packet, approval)`
- `InboundMailProvider.verifyWebhook()` and `classify(message)`
- `BillingProvider.createCheckout()` and `handleWebhook()`

## Feature flags

- `NEXT_PUBLIC_ENABLE_PUBLIC_JOBS=true`
- `ENABLE_EMAIL_ALERT_DELIVERY=false`
- `ENABLE_RESUME_AI=false`
- `ENABLE_APPLICATION_PREP=false`
- `ENABLE_AUTO_APPLY=false`
- `AUTO_APPLY_DRY_RUN=true`
- `ENABLE_BILLING=false`

Flags must default to the safe/off state for integrations that can send, submit, charge or expose user data.

The current CV Studio does not require an AI provider. PDF/DOCX extraction, the published scoring rubric, conservative wording cleanup, explicit keyword verification, side-by-side approval, versioning and export are deterministic. `ENABLE_RESUME_AI` remains reserved for a future optional provider; it must not bypass evidence or approval controls.

## Credentials - request only at the relevant gate

### Existing product data

| Variables | Why | Minimum permission | Can continue without? |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public reads and authenticated user flows | Project URL and anon key with RLS | UI can use labelled fixtures locally |
| `SUPABASE_SECRET_KEY` | Pipeline writes and operational logs | Server-side service/secret role | Yes; ingestion remains disabled |
| `CRON_SECRET` | Authenticate scheduled ingestion | Random bearer secret | Yes; manual fixture runs only |
| `REED_API_KEY` | Authorised Reed feed | Jobseeker API read access | Yes; provider disabled |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Authorised Adzuna feed | Search/read scope | Yes; provider disabled |

### Later integration gates

| Integration | Expected variables | Gate and fallback |
| --- | --- | --- |
| Transactional email | `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Request when alert/contact templates and sandbox tests pass; log-to-console provider before that |
| Inbound application mailbox | Provider signing secret, inbound domain, encryption key | Request after per-user alias, retention and webhook replay tests exist; disabled before that |
| Google/Microsoft mailbox | OAuth client ID/secret and callback URL | Request only for an explicit connect-email feature; never ask for mailbox passwords |
| Text AI | `AI_API_KEY`, model IDs | Request after structured schemas, truthfulness checks, redaction and cost limits pass; deterministic mock before that |
| Billing | Sandbox secret and webhook secret | Request after product/pricing approval and entitlement model; sandbox only |
| Error monitoring | DSN and server token | Request before staging release; local structured logger before that |
| Visual regression/device cloud | Project token | Optional after local baselines; local screenshots remain available |

## Source acquisition policy

- Prefer official APIs, public ATS feeds and commercial feeds with explicit rights.
- Do not scrape LinkedIn, Indeed or protected job portals, bypass authentication/CAPTCHA, or automate against terms of service.
- A user may paste a public job URL for personal analysis, but the system must treat its contents as untrusted input.
- Every imported job retains source, source identifier, first/last seen time and raw evidence needed for a correction audit.

## Callback inventory (future)

- Authentication: production Supabase callback under `https://ir35careers.com/auth/callback` if a server callback route is introduced.
- Mailbox OAuth: `https://ir35careers.com/api/integrations/email/callback`.
- Inbound email: `https://ir35careers.com/api/webhooks/email/inbound`.
- Billing: `https://ir35careers.com/api/webhooks/billing`.

Exact URLs must not be registered until the matching routes, signature validation and staging smoke tests exist.
