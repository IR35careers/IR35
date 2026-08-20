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
      -> Stripe hosted checkout, portal and signed webhook adapter (disabled by default)
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
- `ENABLE_APPLICATION_SUBMISSION=false`
- `ENABLE_BILLING=false`

Flags must default to the safe/off state for integrations that can send, submit, charge or expose user data.

`ENABLE_BILLING` and `BILLING_RELEASE_APPROVED` control new sales only. Once Stripe has been used, keep the server-side Stripe credentials available during a sales pause so the customer portal, signed cancellation/failure webhooks and charge-safe account deletion continue to work.

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
| Transactional email | `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Required for contact notifications, alerts and optional personal-email forwarding; storage-only flows continue without it |
| Inbound application mailbox | `EMAIL_PROVIDER_API_KEY`, `INBOUND_MAIL_SIGNING_SECRET`, `INBOUND_EMAIL_DOMAIN`, `ENABLE_INBOUND_MAIL=true` | Activates deterministic private aliases after DNS, signed-webhook and replay tests pass |
| Application submission gateway | `APPLICATION_SUBMISSION_PROVIDER_URL`, `APPLICATION_SUBMISSION_PROVIDER_API_KEY`, `APPLICATION_SUBMISSION_PROVIDER_NAME`, `ENABLE_APPLICATION_SUBMISSION=true` | Enables only the final explicit-submit action; monitoring and review work without it |
| Google/Microsoft mailbox | OAuth client ID/secret and callback URL | Request only for an explicit connect-email feature; never ask for mailbox passwords |
| Text AI | `AI_API_KEY`, model IDs | Request after structured schemas, truthfulness checks, redaction and cost limits pass; deterministic mock before that |
| Billing | Stripe values plus `NEXT_PUBLIC_PRO_PLAN_PRICE_LABEL`, `NEXT_PUBLIC_PRO_PLAN_FEATURES`, `BILLING_RELEASE_APPROVED`, and the public legal-operator values documented in `.env.local.example` | Apply migration 011 and approve the delivered benefits plus exact GBP interval/VAT copy first; test mode cannot grant Pro, and production remains off until a signed live event passes |
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
- Billing: `https://ir35careers.com/api/integrations/billing/webhook`.

Exact URLs must not be registered until the matching routes, signature validation and staging smoke tests exist.

## Advanced discovery migration gate

Apply `supabase/migrations/012_job_alert_discovery_filters.sql` before deploying the matching alert UI. The migration only adds nullable, constrained `seniority`, `rate_type` and `sponsorship` fields to `job_alerts`; it does not rewrite or delete existing alerts. After applying it, verify an authenticated user can create, reload, preview and delete an alert containing all three values while another user cannot read it.

## Stripe billing acceptance gate

1. Apply `supabase/migrations/011_billing_provider.sql` and confirm browser roles cannot update provider entitlement columns or read the webhook ledger.
2. Publish the operator's real legal name, geographic/service address and monitored privacy email; add company, VAT and ICO numbers where applicable. Checkout fails closed without the three required identity values.
3. Create one recurring GBP price, write the exact amount, interval and VAT treatment into `NEXT_PUBLIC_PRO_PLAN_PRICE_LABEL`, and list only currently delivered benefits in `NEXT_PUBLIC_PRO_PLAN_FEATURES` separated by `|`.
4. Configure Stripe Checkout and the customer portal; allow subscription cancellation without contacting sales.
5. Register the production webhook URL for checkout, subscription and failed-invoice events, then store its signing secret only in Vercel.
6. In test mode, verify checkout, portal access, duplicate-event handling, cancellation and failed-payment behaviour. Test-mode events must leave the account on the free sandbox entitlement.
7. Repeat a controlled live-mode purchase and cancellation with an internal account. Confirm only signed live `active` or `trialing` subscriptions grant Pro.
8. Verify account deletion removes the linked Stripe customer before local data is erased; an unavailable provider must fail closed so a subscription cannot be orphaned.
9. Only then set both `ENABLE_BILLING=true` and `BILLING_RELEASE_APPROVED=true` in the intended Vercel environment. To pause new sales, turn those flags off but retain the provider credentials until every subscription/customer is closed. Never place secret or webhook values in a public variable, Git or browser code.
