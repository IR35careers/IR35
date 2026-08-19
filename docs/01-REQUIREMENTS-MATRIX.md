# IR35Careers requirements matrix

Reviewed: 2026-08-19

This matrix reconciles the existing repository, the 52-page product PDF, and the UI/UX-first execution brief. `Implemented` means the repository contains a production-shaped path. The first public vertical slice has passed its release gates; later authenticated and provider-backed capabilities retain their own gates below.

| Requirement | Priority | Current evidence | State | Next acceptance gate |
| --- | --- | --- | --- | --- |
| Premium, calm, contractor-specific UI | P0 | Tokenised light public shell, contractor-first hierarchy and shared primitives | Implemented for first slice | Extend the same system to every authenticated route |
| Public Inside and Outside IR35 discovery | P0 | Public landing, `/jobs` search and `/jobs/[id]` detail | Implemented | Connect production Supabase data and run staging smoke test |
| Responsive navigation | P0 | Public and member menus adapt across phone, tablet and desktop | Implemented | Authenticated device test with a real staging session |
| Loading, empty, error, success states | P0 | Present on some routes, inconsistent | Partial | Shared state components used by the first end-to-end slice |
| Purposeful motion and reduced motion | P0 | Framer Motion only on waitlist; reduced motion partly handled | Partial | Motion tokens, interruptible transitions, reduced-motion test |
| Profile and onboarding | P0 | Supabase profile, skills, preferences and CV upload | Implemented | Responsive and accessible browser test with production-shaped data |
| Job matching and explanations | P0 | Deterministic weighted scorer and match panel | Partial | Explain contributing factors and avoid presenting score as AI certainty |
| Save and mark applied | P0 | `saved_jobs`, signed-out return path and optimistic rollback | Implemented | Authenticated database/RLS test in staging |
| Job alerts | P1 | Saved search records exist | Partial | Delivery provider abstraction, schedule and unsubscribe before claiming email alerts |
| IR35 provenance | P1 | Status plus high/medium/low confidence | Partial | Persist and display advertised/inferred/manual source and evidence timestamp |
| Resume upload | P1 | Private Supabase bucket and profile reference | Implemented | File signature/virus strategy, signed access and deletion tests |
| Resume builder/editor/rating | P1 | `/jobs/[id]/resume`, four-part deterministic rubric, editable final copy, private/local versions and PDF/DOCX export | Implemented | Apply migration 009 and run authenticated RLS, storage-retention and real-CV acceptance tests in staging |
| Resume optimisation per job | P1 | Role keywords, evidence gaps, conservative rewrites, explicit skill confirmation and side-by-side approval | Implemented without generative AI | Add optional provider only after structured-output, grounding, redaction and cost gates pass |
| Cover-letter generation | P1 | Deterministic role-grounded draft using CV evidence, editable before approval | Implemented without generative AI | Optional provider requires structured-output, grounding, redaction and cost gates |
| One-click application preparation | P1 | CV evidence, cover letter, reviewed questions, three approvals and a dry-run receipt | Implemented for preparation | Live ATS submission stays disabled until a supported adapter, sandbox and final approval token exist |
| Application tracker | P1 | Event-based responsive pipeline with validated forward transitions and non-drag controls | Implemented | Authenticated migration 010/RLS staging test |
| Private application email and inbox | P2 | Alias model, responsive inbox, signed normalised webhook and application linking | Partial | Connect an inbound domain/provider, forwarding, retention worker and webhook replay monitoring |
| Email classification | P2 | Deterministic interview/rejection/action/update classifier and idempotent event update | Implemented at provider boundary | Sandbox corpus, adversarial content and live-provider acceptance test |
| Controlled auto-apply | P2 | Match/rate/IR35/workplace rules, decision log, daily limit and dry-run-only review queue | Partial | Live submission intentionally disabled; add supported provider, receipts and kill switch only after approval |
| Aggregated job sources | P1 | Reed, Adzuna and selected public ATS adapters | Partial | Source terms review, provenance, rate limits, health and stale-data handling |
| LinkedIn/Indeed acquisition | P2 | No authorised integration | Blocked by provider terms/credentials | Use only an authorised API, commercial feed or user-provided link; do not scrape or bypass controls |
| Research/articles | P1 | Resource hub, research route, update feed and versioned article schema with review fields | Partial | Connect an editorial admin workflow and publish sourced long-form articles |
| Contact, testimonials and blog | P1 | Validated private contact storage, product-update feed and consent-only testimonial model/empty state | Partial | Configure production contact storage, publish only approved stories and add editorial admin controls |
| Billing and entitlements | P2 | Plan UI, owner entitlement model and disabled provider contract | Partial | Product/pricing decision, provider sandbox, webhook idempotency and entitlement tests |
| Accessibility | P0 | Axe reports no serious/critical defects in the public journey and account shell | Implemented for first slice | Manual screen-reader, 200% zoom and forced-colours review on staging |
| Performance | P0 | Production Lighthouse baseline captured; public Supabase SDK moved off the initial path | Partial | Establish p75 field data; local simulated results remain variable |
| Automated testing | P0 | Vitest, 146 legacy domain checks, Playwright E2E, axe and visual baselines | Implemented for first slice | Add CI and authenticated/provider integration coverage |
| Security and privacy | P1 | RLS on current user data | Partial | Threat model, fail-closed auth decisions, upload controls, export/deletion and auditability |

## Scope truthfulness rules

- A provider mock is labelled `Demo` or `Not connected`.
- “Email alert” is not shown until a delivery provider is connected and verified.
- “AI match” is not used for the current deterministic job or CV scores. CV Studio exposes the formula and never presents it as a hiring prediction.
- A missing role keyword is never inserted unless the user explicitly confirms that they genuinely have that skill.
- “Outside IR35” must show whether it was stated by the advertiser, inferred from listing text, or manually reviewed.
- “Auto-apply” remains disabled until the user can review the exact resume, answers, destination and submission receipt.
- No real application, email or payment is sent by automated tests.
