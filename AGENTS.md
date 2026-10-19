# IR35Careers engineering instructions

## Current owner deployment constraints — 18 October 2026

- **Zero budget.** Do not upgrade Railway, Supabase, Oracle or any other plan/add-on. Never upgrade OCI to Pay As You Go. Stop and tell the owner before any potentially chargeable action. Leave the empty Railway trial project/service intact and undeployed.
- Worker target is now **Oracle Cloud Always Free Ampere A1**, replacing the Railway deployment plan. Keep pg-boss on the existing Supabase session pooler (5432), least-privilege roles and standby mode. Infrastructure lives in `infra/oracle/`; verify actual Always Free eligibility/quotas before provisioning. The owner signs up first; the agent runs later commands.
- No production runner switch (`APPLY_RUNNER=railway` or `oracle`) and no `APPLICATION_WORKER_ACCEPT_JOBS=true` without literal **YES CUTOVER**. Existing destructive-DB approval and verified-backup requirements remain. No real employer submissions; only mocks and the named test account.
- Keep the default Supabase domain. No paid auth-domain preparation. Phase 0 must add free Google Identity Services + Supabase ID-token nonce handling, consent branding, a flag-protected redirect fallback, and test-account preview verification before production. Preserve admin/GitHub flow compatibility and explain any narrowly required CSP change.
- Secrets never go to chat, logs, command arguments or Git. Use native hidden prompts/stdin. The requested remote worker env is `/opt/ir35-worker/.env`, mode 600, transferred over SSH; any local permitted temporary `.env.worker.local` is ignored and deleted immediately. OCI/SSH private keys remain outside the repo with owner-only access.
- **19 October update policy:** owner selected outbound VM pulls, not GitHub-to-VM SSH. Build/sign linux/arm64 GHCR images from verified main using immutable commit tags and cosign keyless. A five-minute VM timer must reject unsigned/wrong-identity images, drain active work for at most ten minutes, preserve all cutover settings, verify health within two minutes, and automatically restore the preceding verified digest on failure. Read-only GHCR token has only read:packages and mode 600 under /opt/ir35-worker. OCI Bastion is requested as a free backup; its required exact private-endpoint /32 SSH exception conflicts with the literal owner-IP-only rule and is awaiting clarification. Do not add that exception until answered. No registry publication, updater enablement or OCI resources claimed yet.

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
