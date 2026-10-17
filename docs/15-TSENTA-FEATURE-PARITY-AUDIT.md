# IR35Careers — honest Tsenta comparison and release audit

Audit date: 20 August 2026  
Reviewed: live public IR35Careers and Tsenta pages, Tsenta sign-in, the supplied 52-page reference PDF, IR35Careers routes, database migrations and provider boundaries. No private Tsenta area was bypassed.

## Executive verdict

No: IR35Careers does not yet have all Tsenta capabilities, and the signed-in product is not yet better overall.

IR35Careers is stronger at UK contractor discovery: IR35 evidence, rate and workplace filters, source provenance, and its real mobile homepage are clearer than Tsenta's generic job-search positioning. Tsenta is stronger at product narrative and operational automation: it presents one obvious workflow, broader ATS coverage, live submission claims, account creation on employer systems, recruiter-response handling and a more mature product demonstration.

Indicative expert assessment, based only on observable evidence:

| Area | IR35Careers | Tsenta | Verdict |
|---|---:|---:|---|
| Public desktop design | 8.1/10 | 8.6/10 | Tsenta is calmer and more focused; IR35Careers is richer but denser |
| Public mobile behaviour | 8.6/10 | 5.8/10 | IR35Careers reflows cleanly; the audited Tsenta page retained a wide desktop canvas |
| Contractor/IR35 relevance | 9.0/10 | 5.5/10 | IR35Careers has a clear niche advantage |
| Signed-in information architecture | 7.4/10 after this release | 8.5/10 | The new grouped workspace closes part of the gap |
| End-to-end application workflow | 6.8/10 after this release | 9.0/10 | Review and receipts are strong; provider coverage is the major gap |
| Operational integrations | 4.5/10 | 9.0/10 claimed | Email delivery and ATS submission still need authorised providers |

## Capability ledger

| Capability | IR35Careers state | Honest boundary |
|---|---|---|
| UK contract discovery | Live | Search, pagination and authorised feed ingestion exist |
| IR35, rate, workplace and freshness evidence | Live | Strong differentiator; TBC is never presented as Outside IR35 |
| Profile-to-role scoring | Live | Deterministic and inspectable; profile data remains split across legacy and workspace models |
| CV analysis and role score | Live | Includes missing terms, conservative suggestions and explicit evidence checks |
| Truth-preserving rewrite approval | Live | Original and proposed wording remain visible before approval |
| Version history and PDF/DOCX export | Live | Works for approved role-specific CV versions |
| Cover letter and screening preparation | Live | Every field stays editable and reviewable |
| Application journey | Live | Find, prepare, approve, handoff and track now share one visible progression |
| Application tracker and analytics | Live | Account-owned status and event history; employer responses require email delivery |
| Live job-monitor preview | Live after this release | Uses current jobs and the signed-in profile, not hard-coded production demo scores |
| Automatic application submission | Backend-ready, provider-gated | Server queue, explicit approval, idempotency and receipts exist; the UI stays inside IR35Careers and unsupported roles remain queued, but no authorised gateway is connected |
| Recruiter inbox | Backend-ready, provider-gated | Signed inbound route and private alias activation exist; DNS/provider values are still required |
| Personal-email forwarding | Not connected | Deliberately no longer shown as a working toggle |
| Email job-alert delivery | Not connected | Saved alerts and current-match previews work; scheduled outbound delivery still needs a provider and scheduler |
| Employer ATS account creation/login | Not connected | Requires provider-specific consent, credential storage, MFA/CAPTCHA handoff and security review |
| Messaging channels | Not connected | WhatsApp, SMS and iMessage require separate approved providers and consent |
| Native mobile apps | Not connected | Responsive web/PWA is not the same as App Store or Play Store delivery |
| Sign-in, export and deletion | Live | Supabase Auth, account export and explicit deletion flow exist |

## Changes made from this audit

1. Replaced the flat eight-item member header with a grouped, responsive workspace sidebar.
2. Kept contract search inside the same signed-in workspace chrome, so navigation no longer changes when a member opens Jobs.
3. Added a single next-action journey from profile through tracking.
4. Replaced the misleading inbox preview switch with production-derived connection state, private-alias activation and a clean copy action.
5. Added an owner-readable, server-written submission queue with idempotency, payload hashing, provider receipts and explicit approval.
6. Added the authorised submission-gateway route and final-review handoff UI. It remains unavailable when provider values are absent.
7. Changed automation preview from hard-coded production demo scores to live roles plus the signed-in profile, and persisted preview runs.
8. Removed secondary and speculative links from the public footer.
9. Corrected the homepage Prepare route so it enters the application workflow instead of a dashboard fragment.

## Remaining release blockers

These are external resources, not missing UI polish:

- Apply database migration `013_application_submission_queue.sql` in Supabase.
- Choose an authorised application-submission gateway and provide its sandbox endpoint, server key and provider name through Vercel environment variables.
- Choose an inbound/transactional email provider, verify a subdomain such as `apply.ir35careers.com`, and configure the signed webhook secret.
- Configure Supabase custom SMTP for sign-up, magic-link and password-reset delivery.
- Decide whether alerts should be daily or immediate, then add a Vercel schedule and an approved outbound sender.
- Provide sandbox employer roles for Workday, Greenhouse, Lever and Ashby acceptance tests. CAPTCHA or MFA must hand control back to the user.

## Release rule

Never label a provider-gated capability as live until production credentials, least-privilege scopes, consent/revocation, idempotency, redacted logs, sandbox tests, a manual end-to-end test, retention rules and updated privacy disclosures are all verified. Secrets belong in Vercel/provider stores and must never be committed or pasted into a support message.
