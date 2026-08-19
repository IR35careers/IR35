# Phase 0 repository and product audit

Reviewed: 2026-08-19  
Branch: `main`  
Baseline commit: `10ea5ed`

## Repository summary

- Next.js 16 App Router, React 19, TypeScript and Tailwind 3 after the security upgrade.
- Supabase authentication, RLS-backed profiles, saved jobs, alerts and private CV storage.
- Reed and Adzuna aggregators plus Greenhouse, Lever, Ashby and Workable adapters.
- Parsing, normalisation, deduplication, IR35 classification and moderation logs.
- Public SEO landing pages, tools and resource summaries.
- No component test framework, browser test framework, visual regression, accessibility automation or CI quality workflow in the repository.

## Baseline results

| Check | Result |
| --- | --- |
| Git state | Clean before audit; audit screenshots under `tmp/` are intentionally untracked and will be removed |
| Secret pattern scan | No committed key-shaped values found in tracked source |
| Dependency tree | Installs, but local packages have drifted above several package manifest ranges and one extraneous package is present |
| Lint | Existing `next lint` command is deprecated and warns about an incorrectly inferred workspace root |
| Type check | Baseline invocation was started; a clean repeat is required after configuration changes |
| Production build | Bundle compiled in 118 seconds; workspace-root warning appeared; full build remained unusually slow during type/page-data phases |
| Unit tests | Four standalone TypeScript scripts exist but are not wired to package scripts or CI |
| Browser plugin | Local browser runtime failed before opening a tab; live public pages were independently captured with headless Chrome and the limitation is recorded in the reference audit |

## Issue register

### P1 - major

1. **Expired launch experience.** The live homepage says private beta and displays a completed 15 August 2026 countdown while real product routes already exist.
2. **Public discovery is gated.** `/jobs` redirects signed-out visitors, undermining contractor acquisition and SEO.
3. **Direct apply is gated.** Signed-out visitors must register before following an external application link.
4. **Responsive homepage clipping.** The 390px live capture clips the heading, copy, top action and launch card horizontally.
5. **Member mobile navigation is overcrowded.** Five equal-width labels are forced into a narrow second row.
6. **Beta access can fail open.** After two `unknown` access checks the member shell is allowed through. A gate protecting private features must fail closed with recoverable retry.
7. **Combined sign-in/sign-up leaks account state.** An invalid sign-in triggers sign-up and returns a different message for an existing user. Separate intent and neutral errors are safer.
8. **IR35 provenance is missing.** Confidence exists, but the UI cannot tell users whether a status was advertised, inferred or reviewed.
9. **Build root is wrong.** Next.js selects `C:\Users\anves` due multiple lockfiles and scans outside the repository.
10. **Quality gates are absent.** Critical journeys have no E2E, accessibility or visual-regression coverage.

### P2 - moderate

1. Public header exposes only jobs and account; resources and tools are difficult to discover.
2. Static resources cannot support a reviewed editorial workflow.
3. No contact, blog, FAQ, editorial policy or consented testimonial model exists.
4. Root metadata advertises “launching soon” and its SearchAction targets non-existent `/search` instead of `/jobs`.
5. The global stylesheet defaults the body to white text on a dark background while almost every product route overrides it locally.
6. Status badges and design treatments are duplicated across pages.
7. Save/apply state changes lack robust error messages and rollback.
8. The waitlist accepts anonymous inserts directly; abuse controls and retention are not defined.
9. `last_seen_at` and status evidence are not exposed in the public `JobListing` contract.
10. No image asset pipeline or real Open Graph image exists despite metadata referencing one.

### P3 - minor

1. README describes only the old waitlist and no longer reflects the repository.
2. Visual tokens define indigo/teal while product pages use scattered green/slate classes.
3. Several controls use compact heights below the preferred touch target.
4. Some loading paths use a full-screen spinner where a local skeleton would preserve context.

## First vertical slice acceptance criteria

- Public responsive homepage with live search and production-shaped job states.
- Shared public header/footer and semantic tokens.
- Public browse and job detail; sign-in only for saving, alerts and profile-based matching.
- Auth return path preserved.
- Mobile menu/filter behaviour from 320px upward.
- No fake integrations, testimonials or AI claims.
- Focused unit/component checks plus browser screenshots at 390, 768 and 1440 widths.
- No unresolved P0 or P1 defect in changed routes.

## Resolution update — first vertical slice

Resolved on 2026-08-19:

- Replaced the expired waitlist/countdown homepage with the public contractor search experience.
- Removed authentication gates from browsing, job detail and original-listing apply links.
- Rebuilt public and member navigation for mobile, tablet and desktop.
- Changed the beta gate to fail closed with a recoverable retry state.
- Split sign-in and account creation into explicit modes with neutral sign-in errors.
- Added title/listing/no-explicit-status evidence labels without claiming certainty the data does not contain.
- Bounded Next.js output tracing to this repository and upgraded to Next.js 16.3.1.
- Added request cancellation, stale-response protection, optimistic save rollback and a credential-free labelled demo path.
- Added unit, legacy-domain, Playwright, axe and visual-regression gates. The reviewed first-slice run passed 10 tests with 2 intentional non-mobile skips.
- Re-ran the production build successfully and reduced production dependency vulnerabilities to zero in `npm audit`.

Still open, outside the delivered slice:

- Persisting full provenance fields (advertised/inferred/reviewed plus evidence timestamp) requires a schema migration.
- Contact, articles workflow and consented testimonials are later content/product work; no testimonial was fabricated.
- Authenticated onboarding, CV and RLS flows require staging Supabase credentials for a genuine browser test.
- Field Core Web Vitals, Firefox/WebKit and device-cloud coverage remain release gates rather than claims based on a single workstation.
