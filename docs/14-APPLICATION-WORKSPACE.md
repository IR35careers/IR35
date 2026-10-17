# Application workspace and Tsenta-reference feature map

Reviewed: 2026-08-19

## Outcome

The supplied Tsenta screenshots and current public site were treated as workflow references, not a design or code source. IR35Careers now has an original, contractor-specific vertical slice from role discovery through preparation, approval, receipt, tracking and recruiter-message review.

The local preview is fully exercisable without credentials and is explicitly labelled. It never submits an application, sends or forwards an email, charges a card, or presents fictional data as live.

## Implemented workflows

| Reference capability | IR35Careers implementation | Current boundary |
| --- | --- | --- |
| Dashboard and top matches | Responsive dashboard with production-shaped jobs, transparent match factors and local preview support | Live personal matches require Supabase |
| Job feed/detail | Inside, Outside and TBC contracts with rate, location, workplace, skills and status evidence | LinkedIn/Indeed scraping is prohibited; use authorised feeds only |
| Resume optimisation | Four-part CV score, missing keywords, automatic evidence-grounded tailoring, side-by-side review, history and PDF/DOCX export | OpenRouter is optional; the local evidence engine remains available |
| Cover letter | Editable deterministic draft using only job facts and CV-evidenced terms | No invented achievements or outcomes |
| Application questions | Reusable work-authorisation, availability, workplace, relocation, transport, accommodation, employer-history and clearance answers. Known facts are reused; unknown employer questions pause in Needs you | Employer-specific schemas come from the connected application service |
| One-click preparation and direct apply | Automatic CV preparation, one final approval, idempotent submission, resumable employer questions and a confirmed receipt | Direct apply requires a verified employer destination or supported application provider |
| Tracker | Event-based statuses refreshed from the application service and recruiter inbox | Migration 010 requires staging RLS verification |
| Analytics | Account-owned application funnel, response/interview/offer rates, source and status mix, weekly activity, follow-up signals and role-only CSV export | Descriptive only; no hiring prediction or third-party tracking |
| Private email/inbox | A private IR35Careers application address, deterministic classification, application linking, signed idempotent inbound processing and branded customer notifications | Requires a verified inbound domain and Resend credentials |
| Auto-apply settings | Live-role preview, match, rate, IR35, workplace, company exclusion and daily-limit rules with a persisted decision log | Discovery prepares a queue; every external submission still requires explicit approval |
| Profile | Personal details, work authorisation, availability, clearance, limited-company details, document and forwarding defaults | Cloud sync requires Supabase migration 010 |
| Billing | Hosted Stripe Checkout, customer portal, explicit pre-checkout consent, signed webhook ledger, account-owned entitlement updates, sandbox-safe access and a public billing/cancellation policy | Disabled until migration 011, delivered plan benefits, approved pricing and provider acceptance tests pass |
| Networking and referrals | Account-owned contact map, follow-up queue, application-linked editable drafts, explicit review and manual copy | No contact discovery, scraping or automated messaging |
| MCP developer access | Downloadable read-only server for public job search, detail, URL analysis and evidence explanation | No account, CV, messaging or submission permission |
| Research/blog/contact/stories | Research hub, update feed, private contact storage and consent-only testimonial publishing | Editorial admin and real consented content remain launch work |

## Backend and security model

- `application_packets` stores the exact job snapshot, CV materials, letter, answers, approvals, receipt and idempotency key.
- `application_events` records preparation, approval, status and message events.
- `inbox_aliases` and `inbox_messages` keep private mail state owner-scoped; authenticated users can update only the read flag on messages.
- `automation_rules` is constrained to dry-run and human approval in both TypeScript and SQL.
- `user_entitlements` is read-only to the authenticated client.
- `contact_requests` has no public RLS policy and is written only through the server secret client.
- Published articles require reviewed `published` state. Testimonials require both recorded consent and approval.
- Production workspace routes fail closed when Supabase is configured but the user or migration is unavailable.
- The inbound mail boundary requires `ENABLE_INBOUND_MAIL=true`, a valid Svix signature from Resend, a known private alias and a unique provider message ID.
- `application_submissions` is a server-written, owner-readable queue with payload hashes, provider receipts and per-application idempotency.

## Provider gates

### Ready for credentials after the named migration

- Supabase URL, anon key and secret key for authenticated state, ingestion and private contact storage.
- Reed and/or Adzuna read credentials for authorised live contract feeds.
- Stripe sandbox credentials after migration 011 and approval of the exact plan price, interval and VAT copy. Production enablement additionally requires the live acceptance gate in `docs/03-TARGET-ARCHITECTURE-CREDENTIALS.md`.

### Ready for provider sandbox credentials

- ATS submission gateway: set the three `APPLICATION_SUBMISSION_PROVIDER_*` values only after the provider accepts the JSON contract, honours idempotency, returns receipts and passes a sandbox employer flow. Unsupported roles remain queued in IR35Careers while disabled; the UI does not send users away or claim submission.
- Inbound email: verify `INBOUND_EMAIL_DOMAIN`, connect the signed webhook and set the provider values. Important application messages are delivered to the account email and retained in the private inbox.
- Generative AI: add `OPENROUTER_API_KEY` only as a server-side Vercel value. Structured output, identifier redaction, evidence grounding, prompt-injection boundaries and rate controls remain enforced.

## Local verification path

1. Open a demo contract.
2. Choose **Prepare application**.
3. Load the labelled sample CV and prepare the packet.
4. Review the cover letter and each screening answer.
5. Confirm the final packet once and create the dry-run receipt.
6. Confirm the handoff remains queued inside IR35Careers when no provider is configured, with no external navigation and no false submitted state.
7. Open **Applications**, **Inbox**, **Automation**, **Network** and **Profile** from the workspace navigation.

No external side effect occurs anywhere in this path unless the submission feature flag and authorised gateway values are deliberately enabled.
