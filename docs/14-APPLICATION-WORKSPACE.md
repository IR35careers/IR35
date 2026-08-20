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
| Resume optimisation | Four-part CV score, missing keywords, conservative suggestions, verified additions, side-by-side approval, history and PDF/DOCX export | Optional AI provider is off |
| Cover letter | Editable deterministic draft using only job facts and CV-evidenced terms | No invented achievements or outcomes |
| Application questions | Work authorisation, availability, working-pattern and IR35 confirmations; every required answer needs explicit review | Employer-specific schemas require an ATS adapter |
| One-click preparation | Prepare endpoint, exact-material review, three approvals and a dry-run receipt | No live submit button or silent handoff |
| Tracker | Event-based statuses with validated forward transitions and an accessible select alternative to drag-and-drop | Migration 010 requires staging RLS verification |
| Private email/inbox | Alias model, inbox UI, deterministic classification, application linking and signed idempotent inbound endpoint | Inbound domain and forwarding provider not connected |
| Auto-apply settings | Match, rate, IR35, workplace, company exclusion and daily-limit rules with decision log | Enforced dry-run-only and human approval |
| Profile | Personal details, work authorisation, availability, clearance, limited-company details, document and forwarding defaults | Cloud sync requires Supabase migration 010 |
| Billing | Plan/entitlement model and honest disabled checkout UI | Pricing and billing provider not approved |
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
- The inbound mail boundary requires `ENABLE_INBOUND_MAIL=true`, a SHA-256 HMAC signature, a known private alias and a unique provider message ID.

## Provider gates

### Ready for credentials after migration 010

- Supabase URL, anon key and secret key for authenticated state, ingestion and private contact storage.
- Reed and/or Adzuna read credentials for authorised live contract feeds.

### Not ready for live credentials

- ATS submission: requires a named provider, sandbox employer, field capability contract, CAPTCHA/login handoff, final approval token, receipt and kill switch.
- Inbound email: the normalised signed webhook exists, but a provider adapter, inbound domain, retention job and forwarding delivery need staging verification.
- Billing: requires approved pricing, sandbox checkout, signed webhook, cancellation/refund policy and idempotent entitlement processing.
- Generative AI: not required. Any future provider must pass structured-output, redaction, grounding, injection and cost controls.

## Local verification path

1. Open a demo contract.
2. Choose **Prepare application**.
3. Load the labelled sample CV and prepare the packet.
4. Review the cover letter and each screening answer.
5. Complete all three approvals and create the dry-run receipt.
6. Open **Applications**, **Inbox**, **Automation**, **Network** and **Profile** from the workspace navigation.

No external side effect occurs anywhere in this path.
