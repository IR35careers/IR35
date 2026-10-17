# IR35Careers engineering instructions

This is the user-approved phase plan and task policy. Read docs/spec.md, docs/architecture.md and docs/progress.md before implementation. Update docs/progress.md after each task; on “Continue”, take the next unchecked item without shrinking the scope.

8) PHASES
- 0: production fixes (section 1).
- 1: design system, shell, landing, auth + onboarding, SEO.
- 2: ingestion + classifiers + dedupe, then the jobs grid + drawer.
- 3: the CV pipeline (parse, editor, tailor, score, cover letters).
- 4: the apply engine + adapters + needs_info + credits.
- 5: the relay inbox + tracker inbox + pipeline.
- 6: Auto Apply lanes, scheduler, AI chat, alerts.
- 7: billing, referrals, Networking, Research CMS, Workday accounts, mobile polish, /admin dashboard (source health, queue depth, success rate per ATS, failures by reason).

9) RULES FOR EVERY TASK
- TypeScript strict. Zod at every boundary. No secrets in client code. Never weaken RLS or the CSP without explaining why in the PR.
- Tests:
  - Vitest unit tests for the classifiers, parsers, scoring, state machine and truncation.
  - Playwright e2e tests against a mock ATS server. Never apply to real employers in CI or tests.
  - Connector tests use recorded fixtures.
- Privacy (UK GDPR): a record of processing, export/delete, 30-day screenshot retention, and an AI disclosure.
- Small PRs, one concern each. Each PR description covers: what and why, screenshots, tests, migrations, env vars, and manual steps (Supabase, Vercel, DNS, Stripe, Postmark, Google Cloud). Also how to verify in production using anvesh.mannuru+ir35test@gmail.com.
- If something is ambiguous or needs a credential, stop and ask me, and list the options. Never fake data, counts or reviews in the UI.
