# IR35Careers

IR35Careers is a UK contract-discovery product that puts advertised IR35 status, rates, location and working pattern up front. Public visitors can browse and open contract details without creating an account; authentication is reserved for personal actions such as saving roles, alerts and profile-based matching.

## Current product slice

- Responsive public landing page, search, filters and contract detail
- Explicit Inside, Outside and TBC status with an evidence label
- Direct links to original live listings; no silent or automated submission
- Signed-in profile, CV storage, saved jobs, applied state and alerts
- Role-specific CV Studio with PDF/DOCX extraction, transparent scoring, keyword gaps, truth-preserving suggestions, side-by-side approval, version history and PDF/DOCX export
- Truth-first application workspace with editable cover letters, reviewed screening answers, three explicit approval gates and non-submitting receipts
- Responsive application tracker, linked recruiter inbox, contractor profile and controlled automation-rule preview
- Owner-only Supabase application/event/inbox/rule schema plus a signed, idempotent inbound-mail boundary
- Product updates, private contact-request storage and consent-only contractor-story publishing
- Plain-English IR35 resources, an indicative status checker and take-home calculator
- Reed, Adzuna and selected public ATS ingestion adapters
- Clearly labelled local preview data when Supabase is not configured

Generative resume writing is intentionally not required or presented as live. CV Studio and application preparation use deterministic evidence checks and user-approved edits. Local preview can exercise the complete prepare/approve/receipt/track/inbox flow; ATS submission, mail forwarding and billing remain behind the provider and approval gates in `docs/03-TARGET-ARCHITECTURE-CREDENTIALS.md`.

## Stack

- Next.js 16 App Router and React 19
- TypeScript and Tailwind CSS
- Supabase authentication, Postgres and private storage
- Lucide icons and lightweight CSS motion
- Vitest for unit checks
- Playwright and axe for responsive E2E, accessibility and visual regression
- Mammoth and unpdf for in-memory DOCX/PDF text extraction; docx and PDFKit for downloadable CV exports

## Local setup

Requires a current Node.js LTS release and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. With no `.env.local`, development mode serves six production-shaped demo contracts and a labelled fictional workspace. The UI uses non-routable demo domains, stores workspace changes in the browser and disables application submission, email forwarding and payment.

To connect real product data, copy `.env.local.example` to `.env.local` and provide the Supabase public values. Server-side ingestion credentials are optional and should be added only when that pipeline is being exercised.

## Quality commands

```bash
npm run typecheck
npm run lint
npm run test
npm run test:legacy
npm run test:e2e
npm run build
```

The Playwright suite covers the public search-to-detail journey, CV analysis/verification/version/export, application preparation/approval/receipt/tracker/inbox/automation, account intent states, the mobile menu, automated WCAG checks and reviewed screenshots at phone, tablet and desktop widths. It never sends an application, email or payment.

## Production behaviour

```bash
npm run build
npm start
```

Production never falls back to demo contracts. Missing Supabase credentials leave public data unavailable while the static product shell and sitemap continue to build safely. Configure credentials in the hosting provider rather than committing `.env.local`.

## Documentation

- `docs/01-REQUIREMENTS-MATRIX.md` — honest capability and gap map
- `docs/02-PHASE-0-AUDIT-ISSUES.md` — baseline issues and resolutions
- `docs/03-TARGET-ARCHITECTURE-CREDENTIALS.md` — provider, security and credential gates
- `docs/09-UI-UX-REFERENCE-AUDIT.md` — live reference research and original interpretation
- `docs/10-DESIGN-SYSTEM-MOTION-SPEC.md` — visual, responsive and motion system
- `docs/11-VISUAL-ASSET-MANIFEST.md` — asset decisions and approval state
- `docs/12-FIRST-SLICE-RELEASE-REPORT.md` — delivered scope and verification evidence
- `docs/13-CV-STUDIO.md` — scoring, truthfulness, versioning and export behaviour
- `docs/14-APPLICATION-WORKSPACE.md` — Tsenta-inspired feature mapping, implemented workflow and provider gates

## Safety and content principles

- IR35 tools are educational and not legal or tax advice.
- Status evidence is surfaced instead of presenting uncertain classifications as fact.
- Imported jobs retain their source; live applications open the original listing.
- Missing CV keywords are not converted into claimed experience without explicit user confirmation.
- AI, mail, billing and auto-apply providers must remain disabled until their documented review, consent and idempotency gates pass.

## Licence

Proprietary. All rights reserved © 2026 IR35Careers.
