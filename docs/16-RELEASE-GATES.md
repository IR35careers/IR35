# IR35Careers release gates

## What runs before a Vercel build can succeed

Vercel uses `npm run vercel-build`, which runs:

1. strict TypeScript checking;
2. ESLint with zero warnings allowed;
3. the Vitest unit suite;
4. the legacy processing, tax, aggregator and fetcher domain suites;
5. the optimized Next.js production build.

If any command fails, Vercel keeps the previous successful production deployment live.

## What GitHub Actions checks

`.github/workflows/quality.yml` runs for `main`, `codex/**` branches, pull requests to `main`, and manual dispatches. It uses Node.js 22, pinned npm 11.6.2 and exact locked dependencies (`npm ci`) on both Linux and Windows runners.

- **Code quality and production build** repeats the release verification and compiles every route.
- **Responsive browser and accessibility** installs Playwright Chrome and runs the full phone, tablet and desktop suite, including axe checks and provider safety boundaries.
- Homepage visual comparison permits at most 20 changed pixels to absorb runner-level rasterization noise while still failing meaningful copy, spacing or layout drift.
- Browser screenshots and traces are retained for seven days only when the browser job fails. Tests use labelled fictional preview data and never send an application, email or payment.
- Concurrency cancellation stops superseded runs on the same branch instead of wasting runner time.

## One-time GitHub repository setting

For pull-request enforcement, protect `main` in GitHub and require these status checks:

- `Code quality and production build`
- `Responsive browser and accessibility`

The Vercel build gate works from repository code without that setting, but GitHub branch protection prevents an unverified pull request from being merged in the first place.

No provider secret is required by the quality workflow. Production credentials remain in Vercel/Supabase and are never copied into GitHub test logs.
