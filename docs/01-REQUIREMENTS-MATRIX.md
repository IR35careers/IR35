# IR35Careers requirements matrix

Reviewed: 2026-08-20

This matrix reconciles the existing repository, the 52-page product PDF, and the UI/UX-first execution brief. `Implemented` means the repository contains a production-shaped path. The first public vertical slice has passed its release gates; later authenticated and provider-backed capabilities retain their own gates below.

| Requirement | Priority | Current evidence | State | Next acceptance gate |
| --- | --- | --- | --- | --- |
| Premium, calm, contractor-specific UI | P0 | Tokenised light public shell, contractor-first hierarchy and shared primitives | Implemented for first slice | Extend the same system to every authenticated route |
| Public Inside and Outside IR35 discovery | P0 | Public landing, `/jobs` search and `/jobs/[id]` detail | Implemented | Connect production Supabase data and run staging smoke test |
| Responsive navigation | P0 | Public and member menus adapt across phone, tablet and desktop | Implemented | Authenticated device test with a real staging session |
| Loading, empty, error, success states | P0 | Shared state panels and layout-stable skeletons cover public search, job details, alerts, account and CV/application actions | Implemented for public and preparation journeys | Extend route-level skeleton/error boundaries to every authenticated settings/admin surface |
| Purposeful motion and reduced motion | P0 | Motion uses short transform/opacity or colour transitions; global reduced-motion rules disable smooth scrolling and collapse animation/transition durations; Playwright verifies the media state, control behavior and overflow | Implemented | Add manual vestibular review when introducing any new orchestrated animation |
| Profile and onboarding | P0 | Supabase profile, skills, preferences and CV upload | Implemented | Responsive and accessible browser test with production-shaped data |
| Job matching and explanations | P0 | Deterministic weighted scorer, case-insensitive skill comparison, four-factor point breakdown, evidence text and truthful no-overlap state | Implemented | Validate weight usefulness against consented production outcomes before changing the published formula |
| Save and mark applied | P0 | `saved_jobs`, signed-out return path and optimistic rollback | Implemented | Authenticated database/RLS test in staging |
| Job alerts | P1 | Owner-scoped saved searches plus on-demand, cancellable live match previews with loading, empty, error and retry states | Implemented for in-product curation | Delivery provider abstraction, schedule and unsubscribe before claiming email alerts |
| IR35 provenance | P1 | Public details distinguish advertiser-stated, arrangement-derived, source/review and unconfirmed states; exact matched wording and last-observed date are shown | Implemented for deterministic public evidence | Persist reviewer identity and an immutable audit event before claiming a status was manually reviewed |
| Resume upload | P1 | Private owner-scoped bucket; PDF/DOCX signature, active-content, embedded-object, archive-size and replacement/rollback controls | Implemented with local safety checks | Add an approved malware-scanning provider only if the privacy, latency and retention trade-off is accepted; run authenticated storage RLS/deletion tests |
| Resume builder/editor/rating | P1 | `/jobs/[id]/resume`, four-part deterministic rubric, editable final copy, private/local versions and PDF/DOCX export | Implemented | Apply migration 009 and run authenticated RLS, storage-retention and real-CV acceptance tests in staging |
| Resume optimisation per job | P1 | Role keywords, evidence gaps, conservative rewrites, explicit skill confirmation and side-by-side approval | Implemented without generative AI | Add optional provider only after structured-output, grounding, redaction and cost gates pass |
| Cover-letter generation | P1 | Deterministic role-grounded draft using CV evidence, editable before approval | Implemented without generative AI | Optional provider requires structured-output, grounding, redaction and cost gates |
| One-click application preparation | P1 | CV evidence, cover letter, reviewed questions, three approvals, an exact reviewed-material snapshot, receipt feedback and a dry-run receipt | Implemented for preparation | Live ATS submission stays disabled until a supported adapter, sandbox and final approval token exist |
| Application tracker | P1 | Event-based responsive pipeline with validated forward transitions and non-drag controls | Implemented | Authenticated migration 010/RLS staging test |
| Application analytics | P1 | `/analytics` funnel, outcome rates, source/IR35/workplace mix, eight-week activity, review signals and bounded CSV export | Implemented | Add longer-term cohort comparisons when production history is sufficient |
| Private application email and inbox | P2 | Alias model, responsive inbox, signed normalised webhook and application linking | Partial | Connect an inbound domain/provider, forwarding, retention worker and webhook replay monitoring |
| Email classification | P2 | Deterministic interview/rejection/action/update classifier and idempotent event update | Implemented at provider boundary | Sandbox corpus, adversarial content and live-provider acceptance test |
| Controlled auto-apply | P2 | Match/rate/IR35/workplace rules, decision log, daily limit and dry-run-only review queue | Partial | Live submission intentionally disabled; add supported provider, receipts and kill switch only after approval |
| Aggregated job sources | P1 | Reed, Adzuna and selected public ATS adapters; isolated failures, bounded runs, deduplication, ten-day expiry and cached public per-source freshness | Implemented for current authorised sources | Complete recurring provider-terms review and alert operations when a source becomes delayed/stale |
| LinkedIn/Indeed acquisition | P2 | No authorised integration | Blocked by provider terms/credentials | Use only an authorised API, commercial feed or user-provided link; do not scrape or bypass controls |
| Research/articles | P1 | Resource hub, research route, update feed and versioned article schema with review fields | Partial | Connect an editorial admin workflow and publish sourced long-form articles |
| Contact, testimonials and blog | P1 | Validated private contact storage, product-update feed and consent-only testimonial model/empty state | Partial | Configure production contact storage, publish only approved stories and add editorial admin controls |
| Billing and entitlements | P2 | Hosted Checkout and portal routes, signed/idempotent Stripe webhook ledger, owner entitlement model, sandbox-safe access, billing policy and charge-safe account deletion | Provider-ready, disabled by default | Apply migration 011, approve product/price and tax copy, then pass Stripe test and live-mode acceptance checks before enabling |
| Networking and referrals | P2 | `/network` account-owned relationship map, follow-up dates, role-linked reviewable drafts, manual copy and export | Implemented for user-controlled preparation | Any delivery provider needs consent, revocation and anti-spam review; autonomous outreach remains off |
| MCP access | P2 | Downloadable v2 MCP server with four read-only tools and protocol-level client test | Implemented, read-only | Add authenticated tools only after OAuth, consent, scope and revocation design |
| Accessibility | P0 | Axe reports no serious/critical defects in the public journey and account shell | Implemented for first slice | Manual screen-reader, 200% zoom and forced-colours review on staging |
| Performance | P0 | Production Lighthouse baseline captured; public Supabase SDK moved off the initial path; featured jobs server-rendered; public detail pages request-deduplicated and cached for 60 seconds; search renders twelve results before background facet aggregation and caches facet counts by stable filters | Partial | Establish p75 field data; local simulated results remain variable |
| Automated testing | P0 | Vitest, 186 legacy domain checks, Playwright/axe at three viewports, Vercel pre-build gate and two-stage GitHub Actions workflow with failure evidence | Implemented for provider-independent release gates | Add authenticated Supabase and provider-sandbox integration jobs after test credentials exist |
| Security and privacy | P1 | RLS, fail-closed provider gates, account export/deletion, validated CV ingestion, private storage boundaries, public reporting rules and RFC-style `security.txt` discovery | Partial | Complete formal threat model, authenticated RLS/deletion test and provider audit monitoring |

## Scope truthfulness rules

- A provider mock is labelled `Demo` or `Not connected`.
- “Email alert” is not shown until a delivery provider is connected and verified.
- “AI match” is not used for the current deterministic job or CV scores. CV Studio exposes the formula and never presents it as a hiring prediction.
- A missing role keyword is never inserted unless the user explicitly confirms that they genuinely have that skill.
- “Outside IR35” must show whether it was stated by the advertiser, derived from an arrangement signal, or supplied by a source/review process; a manual-review claim requires an audit record.
- “Auto-apply” remains disabled until the user can review the exact resume, answers, destination and submission receipt.
- No real application, email or payment is sent by automated tests.
- Networking tools never discover contacts or send outreach; the user supplies, reviews and manually copies each message.
