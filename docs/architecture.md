# Current architecture and target mapping

Audited 15 October 2026 at `0df1489`. This describes checked-in code and the limited live checks below, not a claim that every integration works in production. `spec.md` remains the target; `progress.md` records completion.

## Superseding owner choices — 18 October 2026

Zero budget: leave Railway's empty trial project undeployed, never upgrade Oracle to Pay As You Go or activate a paid auth domain. The persistent host target is Oracle Always Free A1 in London, with the existing Supabase pg-boss session pooler and unchanged standby/cutover gates. Oracle account activation is still awaiting the owner; no VM/resources are claimed. The default Supabase domain is retained; Google Identity Services + hashed nonce/ID-token exchange and free consent branding replace the paid-domain requirement. Detailed tasks and cost/idle-capacity caveats are in the top of `progress.md`. Historical Railway/paid-domain notes below are not current authorization.

PR #25 merged as `ee362a1` after all 15 final-head checks passed at `81c3af5`, including Docker/Postgres and three browser projects. Its callback/resend/confirmed-email/job-context code is merged, not released. Main and preparation branch families retain the Vercel Git deployment hold; an explicit isolated/test-account preview is a separate gate. Migration 025 and compatible web rollout remain pending, with no runner cutover approved.

## Runtime and release boundaries

- Next.js App Router, React 19, strict TypeScript, Tailwind; deployed on Vercel. `package.json` runs typecheck, ESLint, Vitest and legacy checks before the production build.
- Supabase Auth/Postgres/Storage serve the web application. Browser clients use the public key and owner RLS. `src/lib/supabase-admin.ts` currently also exposes a privileged server client to web APIs. **The target's worker-only service-role boundary is not implemented.** Migrate privileged operations behind scoped worker commands without weakening RLS.
- `src/proxy.ts` supplies the canonical-host/auth/security boundary, including nonce CSP. Nonce-bearing HTML remains dynamic; public job data uses five-minute caches. Static marketing HTML needs a separately reviewed CSP design, not removal of CSP.
- `vercel.json` schedules ingestion at 06:00 and automation at 06:15 daily. Both still perform substantial work. Target crons must enqueue container work only.
- Production release `0df1489`: `https://ir-35-8xenk1omw-ir-35-t.vercel.app`. Build passed 471 unit tests and 199 legacy checks. This release concerns SEO/feed quality, not completion of Phase 0.

## Routes and reusable UI

| Area | Current implementation | Reuse / remaining target work |
| --- | --- | --- |
| Marketing | `/`, `/pricing`, `/resources`, `/research`, `/blog/[slug]`, `/contracts/[slug]`, `/tools/*`, `/analyse-job`, legal/contact routes | Reuse server metadata, category inventory, guides, legal components and tools. Reconcile exact new hero, real stats, typography, spacing and target pricing. |
| Account | `/account`, `/account/reset`, `/auth/callback`, `/account/github`, `/onboarding` | Reuse auth context, Google identity, callback routing and GitHub public-data import. Verify canonical callback, expiry/resend, apply context, confirmed email and onboarding resumability. Custom auth domain needs dashboard/DNS configuration. |
| Workspace | `/dashboard`, `/jobs`, `/jobs/[id]`, `/automation`, `/applications`, `/applications/new/[jobId]`, `/inbox`, `/profile`, `/settings`, `/network`, `/saved`, `/alerts` | Reuse `WorkspacePage`, `JobsWorkspaceShell`, `ApplicationStudio`, `ApplicationTracker`, `RecruiterInbox`, `ContractorProfile`, `AutomationSettings`. Match the accepted dashboard while delivering the specified screens. |
| Administration | `/admin`, `/admin/login`, admin-host routing, `/api/admin`, `/api/admin/session` | Existing contractors, CV access, feedback, administrators, sources and runner diagnostics are reusable. Verify least-privilege access and add target queue/source/ATS metrics. |
| Shared UI | `src/components/ui`, `AppNav`, `AppMotion`, home motion, `FeedbackBubble`, brand/company-logo/IR35 badge/state/progress components | Lucide and Framer Motion already installed. Shared shadcn primitives, Lexend, Recharts, target MatchRing/JobDrawer and owner's sidebar are not fully established. No Carbon dependency or `sidebar-component.tsx` found. |

`src/app/layout.tsx` currently uses Inter. The target light/dark tokens, 12px/8px radii, WCAG contrast, keyboard operation and reduced-motion behaviour need systematic verification; existing animations are not evidence of accessibility compliance. Mobile support-widget/modal/bottom-bar collisions require device regression tests.

## APIs and processing

- Jobs: `/api/jobs/search`, `/api/jobs/[id]`, `/api/jobs/preview`; public metadata/data in `seo.ts`, `job-seo.ts`, `public-jobs.ts`, `public-job-inventory.ts`. Reuse safe JSON-LD, truthful salary/description eligibility and empty-category noindex rules.
- Ingestion: `/api/pipeline/fetch` -> `pipeline/run-fetch.ts`. Reed/Adzuna official APIs plus Greenhouse, Lever, Ashby, Workable and SmartRecruiters fetchers. Admin source registry is stored in `moderation_logs`, not a dedicated `sources` table. Preserve provider isolation, SSRF guards, rate limits, normalized raw-job contracts and classifiers.
- `processing/*` implements UK/professional-role gates, explicit-evidence IR35 classification, rate parsing, skills and fuzzy dedupe. Conservative repair expires rows with an original-value audit. Missing target pieces: Teamtailor/Recruitee/Workday read-only connectors, recorded fixtures across connectors, pg_trgm canonical multi-source identity, persisted source health, 12–24h rechecks, Companies House and pgvector search/matching. Current stale expiry is ten days.
- CV: `/api/resume/parse`, `/api/resume/export`, `lib/resume/*`, `components/resume/*`; unpdf, mammoth, PDFKit and DOCX already available. Reuse normalization, identity extraction, exports, previews and refinement. New incident fixtures and per-fact validation must prove fixes; target PDFJS/structured OpenAI extraction, complete score breakdown and individual diff acceptance remain to be reconciled.
- AI: local/OpenRouter tailoring and field mapping exist in `lib/ai/*` and `application-runner/openrouter-mapper.ts`. This is not the requested OpenAI JSON-schema/versioned-prompt/per-user-cost service. Preserve deterministic evidence constraints when replacing it.
- Mail: alias, inbound, sync and send APIs under `/api/integrations/email`; Resend utilities, verification extraction/recovery, message categorization and safe display. Reuse signature validation and application linkage. Audit raw MIME retention, automatic forwarding, push, scoped Gmail/Outlook access and provider DNS before claiming full relay coverage.
- Billing: Checkout/Portal/webhook routes and Stripe release/legal gates exist. `user_entitlements` is not the target append-only `credits_ledger`/subscriptions/referrals design. Never enable charges from a mock entitlement or unverified live price.
- Networking is user-added contact/outreach state in profile JSON. Preserve draft-only behaviour; no inferred personal contacts or automatic sending.

## Hosted preparation checkpoint — 18 October 2026

The real encrypted auth/public/storage + globals backup is verified; see `pre-migration-backup.md` for actual sizes/counts and restore limitations. Additive migration **024** is installed: the private pgboss schema and service-only watchdog exist, browser access/execution is denied. The watchdog has not been invoked and no queue job/application was modified. Only 024 is recorded in CLI migration history; do not replay the unregistered legacy migrations with `db push`.

Migration **025 remains uninstalled** pending compatible database/web rolling-client release. Queue owner/producer logins and hosted pg-boss setup are not yet installed. Railway standby setup is authorized, but production cutover is not. An empty `ir35careers-worker` project / `ir35-worker` service now exists, with no source, secrets or deployment. The account rejected the requested 2 GB limit with a 1 GB plan ceiling; owner plan review is required before deploying the specified capacity. The temporary Vercel Git deployment hold remains in place. P0.3–P0.8 code/regressions are merged through PR #24, not yet verified on production. The last post-merge live recheck still reports 0df1489. P0.9's dedicated callback/resend/confirmed-email/apply-context gaps are audited in `incident-auth.md`, not implemented or configured by that audit.

## Branch implementation update — migration 025, not installed yet

The active Phase 0 branch adds authoritative `application_packets.delivery_status`, `delivery_version`, failure reason/detail and start time, retaining the packet's legacy `status` solely as a recruiting/compatibility projection. Database guards enforce forward-only edges and an explicit service-only Retry RPC. Task claims and outcomes write delivery events atomically; a result RPC commits packet, submission and task projections together. Absolute task attempt IDs never reset, so old callbacks cannot affect a new explicit Retry. Claims never reclaim a running unknown outcome; at most two proven pre-submit transient retries are allowed.

Direct browser INSERT/UPDATE grants are revoked (including historical column grants). Owner-checked `save_application_draft` permits only whitelisted material fields with version CAS. It cannot write receipts or delivery state. The shared cloud store coalesces saves, surfaces failures, subscribes to owner-RLS INSERT/UPDATE Realtime and refreshes on reconnect/focus. Status GET uses the owner JWT/RLS and performs no writes or browser/provider calls. The modal distinguishes queued from actual submitting; page and tracker show stored state and external-only handoff. These changes require migration 025 **before** releasing the branch; absence of the lifecycle fails closed rather than fabricating Ready. Target normalized `applications`/profiles and worker-only privileged commands remain later migration work, not claimed complete by adding these columns.

The following three-state runner description is the audited **production baseline**, not a description of the uninstalled branch fix.

The branch also retires the legacy extension token exports/result callback so it cannot compete with the authoritative worker. Manual employer-page submissions are saved as explicitly unverified notes, not invented confirmation receipts. Receipt guards reject preview/self-report prefixes and preserve their original historical data. The extension-free employer link does not start a parallel application while delivery is in flight.

## Production baseline: three persisted states, not one

1. `application_packets.status` uses legacy `draft`, `ready`, `needs_review`, `applied` and subsequent recruiting stages (`workspace/types.ts`).
2. `application_submissions.status` records delivery (`queued`, `processing`, success/failure/cancellation).
3. `application_worker_tasks.status` records queue/lease state (`queued`, `running`, `completed`, `needs_user`, `failed`, `cancelled`).

`application-delivery-status.ts` derives an operational report across those tables. `workspace/repository.ts` maps the packet status directly into the UI; attention is shown only for `needs_review`. `application-submission-state.ts` additionally infers in-flight state from human-readable event labels. This split must be replaced with an authoritative, audited application lifecycle without dropping recruiting stages or historical receipts.

Production currently selects **Vercel Queues** whenever `VERCEL=1` (`application-cloud-queue.ts`). `/api/queues/applications` has a 300s maximum and 360s visibility timeout. `application-cloud-worker.ts` claims a database task and executes a browser assignment with a 210s budget, then posts a signed callback. Queued work survives the initiating browser request, but execution is still bounded serverless work, not the specified persistent container.

An optional reusable container already exists at `services/application-worker/{server.ts,Dockerfile}`: Node 22, Playwright Chromium, health endpoint, concurrency cap and signed claim/callback protocol. It polls and heartbeats every 30s, accesses the web control plane rather than Supabase directly, and has a short shutdown deadline. Migration 020 claims with `FOR UPDATE SKIP LOCKED`, six-minute leases and up to five attempts. These differ from the target's 15s heartbeat, ten-minute watchdog and at most two transient retries. No Fly.io/Railway deployment manifest or authenticated local CLI was found. Do not switch off the live consumer until a replacement worker is deployed and verified against mock ATS only.

Live read-only delivery check at 06:24 UTC: 78 packets; six provider-confirmed receipts; 36 need user action; four approved packets without a submission; no currently queued/running tasks. Absence of a recent heartbeat while the event-driven consumer is idle does **not** establish an outage. The reported incident job currently has a saved `needs_review` packet and `needs_user` worker outcome, action `employer_login`, on Adzuna, without a submission receipt. Account attribution and the full request/event timeline still require evidence; see the incident task. No employer application was triggered during this audit.

## Existing schema and RLS

Migrations 001–021 and 023 are present. Production schema installation is not inferred from files; only the decimal-rate follow-up was user-confirmed this turn and then exercised successfully.

| Existing storage | Target mapping / migration need |
| --- | --- |
| `jobs`, `moderation_logs` | Keep jobs and audit history; add canonical `companies`, `job_sources`, `sources`, FTS/skills/vector indexes and missing structured fields. |
| `profiles` keyed by auth user, including `application_profile` JSON | Separate account-level `users_profile` from multi-persona `profiles`; migrate embedded personas/saved answers/network state without loss. |
| `resume_versions`, private `cvs` bucket | Migrate or map to `cv_versions`; retain file ownership and historical application references. |
| `application_packets`, `application_events`, `application_submissions`, `application_worker_tasks`, `application_worker_heartbeats`, `application_portal_sessions` | Preserve idempotency, receipts, private sessions and leases; implement authoritative lifecycle, transition events and screenshot retention. |
| `inbox_aliases`, `inbox_messages`, `email_delivery_events` | Map to `email_messages`, raw MIME/object references, relay forwarding and status transitions. |
| `automation_rules`, `automation_runs`, `job_alerts` | Migrate to detailed lanes/saved searches, scheduling and notification state. |
| `user_entitlements`, `billing_consents`, `billing_webhook_events` | Retain signed webhook idempotency/legal consents; introduce subscriptions, credit grant/consume/refund ledger and referrals. |
| `contact_requests`, `articles`, `testimonials`, `feedback_messages`, `admin_members` | Reuse CMS/support/admin foundations with verified permissions. |

Target `matches`, `saved_answers`, `memories`, `ats_accounts` and the normalized tables above are not present under those names. Embedded equivalents do not meet the full target semantics.

RLS is enabled in the migrations on user tables. Jobs allow anonymous reads of unexpired listings. Profile/CV policies are owner-scoped. Migration 017 hardens private CV folder updates, makes alias writes server-only, restricts browser packet edits to pre-submission states and column grants, and limits user event inserts to preparation events. Migration 020 revokes queue/heartbeat access from anonymous/authenticated users and grants the claim RPC only to service role. These protections must be preserved; a database-level lifecycle must also stop stale browser writes from regressing an in-flight packet. Verify installed policies with `supabase/verification/017_security_hardening_checks.sql` when authenticated DB access is available.

## Configuration inventory (names only; never commit values)

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`; custom OAuth domain/callback allowlist are external settings.
- Jobs: `REED_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOB_DECIMAL_RATES_ENABLED`; migration 023 enables numeric(12,2) rate storage. Provider credentials stay server-side.
- Runner: `APPLICATION_WORKER_SECRET`, `IR35CAREERS_APP_URL`, worker/browser budget/headless/executable settings; Vercel queue configuration in `vercel.json`. Target container/database or Redis credentials and Sentry configuration need owner-selected hosting.
- Mail: Resend/email-provider keys, sending identity/reply-to, inbound signing secret/domain and delivery flags. SPF/DKIM/DMARC/MX are external evidence, not code changes.
- Billing: Stripe secret/webhook secret/live price IDs, billing release and operator/legal flags.
- AI/analytics/feature flags: existing provider-specific AI, Google and public feature variables. Audit availability privately; presence of a variable name is not evidence of a valid connection.

## Verification and migration approach

Reuse Vitest classifier/parser/state/worker/SEO tests, Playwright mock ATS fixtures and recorded connector fixtures. Keep new boundaries Zod-validated; Zod is not currently a project dependency. Avoid live employer submissions in all automated testing. Make one production-fix PR per brief bullet, with migration/environment/manual steps and test-account verification. Track each gate, missing credential and production result in `progress.md`.

Security/performance decisions needing explicit resolution: keep actual advertised units/currency instead of inventing GBP/day salary or expiry; incomplete source snippets cannot honestly qualify for JobPosting. HTTP same-host HTTPS upgrading is required for HSTS preload, so an apex HTTP request can take two hops to canonical www. Static public HTML needs a nonce-compatible policy redesign. None of these are silently marked complete against the stronger target.
