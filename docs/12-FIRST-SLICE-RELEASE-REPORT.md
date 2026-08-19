# First vertical slice release report

Reviewed: 2026-08-19

## Outcome

The first useful IR35Careers journey is implemented end to end: a contractor can land on the product, search or filter contracts, compare status/rate/location evidence, open a detail page and follow the original listing. Saving remains a personal action and therefore presents an explicit sign-in return path.

When Supabase is absent in development, six production-shaped fixtures exercise the same API and UI contracts. Every fixture is labelled preview data, uses `demo.ir35careers.local`, and cannot submit an application. Production never uses this fallback.

## Delivered scope

- Original responsive public homepage and shared public header/footer
- Desktop, tablet and mobile contract discovery
- Public job detail with truthful apply/save states
- Explicit sign-in and create-account modes
- Responsive member navigation and fail-closed access check
- Semantic brand, button, status, focus, surface, motion and reduced-motion tokens
- Skeleton, empty, failure, preview and optimistic-rollback states
- Lazy Supabase loading so unauthenticated public pages do not pay the SDK cost
- Labelled demo provider fallback and a credential-safe sitemap build
- Updated framework, lint configuration, scripts, environment example and project README

## Acceptance evidence

| Gate | Result |
| --- | --- |
| TypeScript | `npm run typecheck` passed |
| ESLint | `npm run lint` passed with zero warnings |
| Unit | 5 Vitest assertions passed |
| Existing domain tests | 146 processing, tax and aggregator checks passed |
| E2E | 10 Playwright tests passed; 2 mobile-only tests skipped on non-mobile projects by design |
| Accessibility | Axe found no serious or critical issues on landing, detail and account journeys |
| Visual regression | Reviewed phone, tablet and desktop baselines pass without diff |
| Responsive overflow | Automated mobile assertion passed; manual 390/768/1440 review completed |
| Production build | Next.js 16.3.1 build passed, including static sitemap generation without credentials |
| Vulnerabilities | `npm audit` reports zero known vulnerabilities |
| Secrets | No key-shaped secrets found in project source |
| Licences | No production package lacks licence metadata; transitive LGPL/CC attribution obligations are recorded for release notice review |

## Performance baseline

Lighthouse was run against the local production build with simulated mobile conditions. Results varied materially on the Windows workstation, so they are a baseline rather than a p75 production claim. The strongest representative run after lazy-loading Supabase scored 94 performance, 100 accessibility, 96 best practices and 100 SEO, with 1.1s FCP, 2.6s LCP, 0 CLS and 200ms TBT. Repeated runs showed CPU-sensitive variation; field monitoring remains required before calling the performance budget complete.

The main corrective action from the profile is already implemented: the Supabase SDK moved out of the initial public bundle. The landing experience also uses no hero raster, no video and no unnecessary animation library work.

## Known gates and next plan

1. Connect a staging Supabase project and test sign-up, sign-in, onboarding, CV upload, RLS, saving and alerts with disposable accounts.
2. Add provenance columns and a reviewed evidence UI before treating classification confidence as full audit history.
3. Establish CI on a clean checkout, add Firefox/WebKit projects, and run manual keyboard, screen-reader, zoom and forced-colours checks.
4. Add real-user performance monitoring and enforce p75 LCP/INP/CLS budgets from staging through production.
5. Build the reviewed article workflow and validated contact route; add testimonials only after named consent and copy approval.
6. Keep email delivery, AI, billing and application automation disabled until the provider, privacy, idempotency and human-approval gates in `docs/03-TARGET-ARCHITECTURE-CREDENTIALS.md` pass.

No external application, email, payment, DNS record or production data was changed during implementation or testing.
