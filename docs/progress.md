# IR35Careers delivery checklist

Updated 15 October 2026. Source of truth: `spec.md` and the original Phase 0 brief, preserved below. `[x]` means evidenced completion; existing partial implementations stay unchecked. Continue with the first unchecked task. Update this file after each completed task. Never infer production success from UI copy or a deployment alone.

## Active Phase 0 delivery authority — 15 October follow-up

The owner's end-to-end Phase 0 instruction supersedes the earlier **prepare-only** restriction. Standby infrastructure deployment is now authorized; production `APPLY_RUNNER=railway` and worker `APPLICATION_WORKER_ACCEPT_JOBS=true` still require the literal **YES CUTOVER**, which has **not** been received. Never test against real employers. The owner only supplies native logins/secrets and final approval; the agent runs commands. No destructive database change without separate approval.

- [ ] Step 1: finish lifecycle/incident/UI/reload/mock tests and Docker/Postgres CI; all checks green before merging. Migration **025** is additive and required before releasing the new UI; do not let a main-branch Git deployment race its installation.
- [ ] Step 2: install/check all five requested CLIs/Docker and link accounts/projects. Supabase CLI browser login succeeded; CLI project read confirms `kxcbgflleqnjzjbkevwd`, healthy, `eu-west-2`. Vercel is already authenticated. Railway/GitHub CLI/Docker remain unverified or missing.
- [ ] Step 3: backup/PITR evidence, migrations 023 if needed, 024 and 025, least-privilege pg-boss roles, verified session-pooler URLs, private schema and seven queues.
- [ ] Step 4: Railway `ir35-worker`, nearest region, 1 vCPU/2 GB, one replica/no sleep, stdin secret transfer, standby deploy and real browser/database health; $30/month alert.
- [ ] Step 5: live-worker staging/mock ATS matrix (duplicate/outage/restart/lost acknowledgement/watchdog/cancellation/reload), no employer traffic.
- [ ] Step 6: obtain **YES CUTOVER**, switch producers/consumer, verify mock receipt and queued ingestion, then observe logs for 30 minutes.
- [ ] Step 7: deployment/evidence/env-name/rollback/remaining-phase report; attach consumer-removal follow-up PR, leave unmerged for the seven-day rollback window.

Step 1 progress: additive delivery lifecycle, atomic result/event RPC, CAS draft saves, monotonic attempt IDs, stored-state Realtime/reload mapping, read-only status GET, explicit Retry and external-only UI are implemented in the working branch, not deployed. SQL regressions execute the actual migrations with embedded PostgreSQL (PGlite), including stale state, receipt integrity, timeout, crash, tenant ownership, duplicate result and stale callback cases. First full verification passed 497 tests/109 files + 199 legacy checks, TypeScript/ESLint and a production build; additional regression tests and final CI are pending. Docker standby CI is added but not yet run. Existing npm audit failures remain unresolved; they are not silently waived to obtain a green badge.

Incident evidence: authenticated Supabase CLI read-only query confirmed the named test account and full persisted timeline; see `incident-auto-apply.md`. Vercel CLI historical query returned no retained entries at the later check, so earlier captured Vercel evidence is clearly distinguished. A temporary `.env.worker.local` created for diagnostics was deleted; no credential values were printed or committed. No migrations, queues, Railway resources or production flags have been changed by this follow-up.

Latest checkpoint: six controlled Playwright browser tests passed, including an actual mock-form confirmation committed through migration 025's RPC and rendered as Submitted after tracker/page reload. That local UI test hydrates the labelled preview from the SQL result; it is **not** a claim of live Supabase Realtime or Railway staging connectivity. GitHub CLI 2.102.0 was installed in user scope; its browser login is in progress. The later full release check passed 502 tests/110 files and 199 legacy checks; the last modal-phase regression and final CI run are still being checked.

CI repair checkpoint: release run `38702026292` failed dependency installation and the Docker build. Reproducing its pinned npm 11.19.0 locally found missing `@emnapi/core` / `@emnapi/runtime` 1.11.3 lock entries; the workstation's default npm was 11.6.2. Regenerated only the lockfile with npm 11.19.0; the exact-version `npm ci --ignore-scripts --dry-run` now succeeds. No security gate is waived. The latest full local suite passed 503 tests/110 files and 199 legacy checks; final Docker and browser CI remain pending. Railway CLI 5.68.0 is installed but not authenticated; Supabase is linked and Vercel authenticated. GitHub device approval expired twice; a fresh native login is pending. No production release or cutover has occurred.

## Plan persistence and audit

- [x] Persist section 8 phases and section 9 rules in root `AGENTS.md`; read them before further implementation.
- [x] Preserve mission and sections 2–7 in full in `docs/spec.md`.
- [x] Audit routes, reusable components, data tables/RLS, ingestion, environment names and current apply runner in `docs/architecture.md`.
- [x] Create this full phase checklist, including manual configuration and evidence gates.
- [ ] Read architecture/progress, then open the first focused Phase 0 PR with the incident findings, authoritative lifecycle and persistent-worker reliability work; attach the PR to this chat.
- [x] Open and attach draft foundation PR [#1](https://github.com/IR35careers/IR35/pull/1) for the Railway preparation and incident evidence. It is deliberately not ready: authoritative lifecycle, external_only, full incident attribution and live worker verification remain unchecked.

## Phase 0 — production first (one PR per brief bullet)

- [ ] P0.1 Investigate 15 October incident: test account `anvesh.mannuru+ir35test@gmail.com`, Adzuna job `7d8d7d76-72f9-4245-8112-b43a1ae5b797`. Correlate request, database, queue, worker and Vercel logs; reproduce only against mock ATS; write `docs/incident-auto-apply.md`. Live read-only snapshot shows saved employer-login attention, not confirmed submission. Do not attribute this row to the test email without confirmation.
- [ ] P0.2 Authoritative lifecycle `draft > needs_profile > awaiting_approval > queued > submitting > submitted | needs_info | failed | external_only | skipped`; forward-only transitions except explicit Retry; durable transition events, failure reason/detail and retained recruiting history; UI reads stored status via Realtime. Stop stale browser drafts overwriting progress. Unresolvable aggregator -> external_only with employer-site action.
- [ ] P0.2a Persistent Node/Playwright/Chromium worker on owner-selected Fly.io or Railway; pg-boss or BullMQ/Upstash; web stays light; ingest/enrich/match/tailor/apply/mail/alerts queues; crons enqueue only. Stage and mock-verify before live consumer cutover.
- [x] P0.2a-prep Owner selected Railway + pg-boss on existing Supabase session pooler 5432; explicitly **prepare only, do not deploy**. Added pinned Playwright Dockerfile, railway.toml, standby /health, environment template, seven queue definitions, apply/ingest/scheduler consumers, feature-flagged Vercel producers and exact owner-run deployment/cutover/rollback guide. Live cutover and remaining handlers are not complete.
- [ ] P0.2b 15s heartbeat, ten-minute submitting watchdog -> `runner_timeout`, at most two transient retries, Sentry, duplicate/lease guard, kill switch and queue health. Test crash/restart/lost callback/timeout paths.
- [ ] P0.3 CV parser: spaced-letter PDF fixture; valid name/location, user-named CV; file magic bytes; helpful non-PDF/SharePoint HTML rejection. Regress Cloud Platforms / RBAC, IAM misidentification.
- [ ] P0.4 Answer AWS and Azure questions independently from evidence; sentence-safe maximum lengths; test the truncated “Azure (AKS,” case.
- [ ] P0.5 Remove unknown-value placeholders from question text, including “advertised unknown working pattern”.
- [ ] P0.6 Persist edited answers across Form/CV/Cover letter/Contract tab changes and reloads without racing server state.
- [ ] P0.7 Fix controlled approval checkbox for direct input, label, touch and keyboard operation.
- [ ] P0.8 List exact missing fields/approvals whenever Submit is disabled; explain disabled “Apply to next match now” on `/automation`.
- [ ] P0.9 Auth: canonical `https://www.ir35careers.com/auth/callback`; expired OTP handling/resend; confirmed-email apply gate; logged-out job/company context and safe return; `/profile#apply-settings` deep link; Supabase custom domain + Google branding (external DNS/provider setup).
- [ ] P0.10 Full job description / Read more without mid-word truncation; truthful source-summary handling and mobile expansion.

## Phase 1 — design system, shell, landing, account/onboarding, SEO

- [ ] D1 Establish shadcn/ui primitives, Lucide, Framer Motion, Recharts, Lexend headings/UI + Inter body; exact ink/forest/emerald/rose/amber/sky tokens and five card pastels from spec.
- [ ] D2 Card 12px/input 8px/pill radii, 4px spacing; light/dark themes; WCAG 2.2 AA contrast, visible focus, keyboard and reduced motion; mobile device checks.
- [ ] D3 Shared IR35Badge with confidence/Why evidence quote, MatchRing bands, pastel JobCard (logo/location/age/skills/Pass/Apply), JobDrawer, StatusPill, one-action EmptyState and skeletons.
- [ ] D4 App shell: Dashboard/Browse jobs/Auto Apply/Tracker/Networking/Profile/Research, Settings/credits/avatar; mobile bottom bar; no support-widget collisions, overflow or clipped modals.
- [ ] D5 Owner's two-level sidebar in `/components/ui/sidebar-component.tsx`; Carbon icons, exact spring easing, real content/brand and mobile Sheet. Obtain the owner's component if absent rather than pretending to reuse it.
- [ ] L1 Sky-gradient landing with exact outcome headline, Start free/Browse contracts CTAs and real product screenshot.
- [ ] L2 DB-backed live roles/source/average-day-rate stats; three-step explanation, features, tools, pricing, FAQ/footer. No fabricated logos, endorsements, counts or reviews.
- [ ] A1 Split account screen with pitch/three ticks, Google/email; preserve safe return context and configuration/error states.
- [ ] A2 Resumable onboarding: heard-from options, CV upload/parse/confirm; roles/skills/location/workplace/minimum rate/IR35/engagement/availability/clearance/right-to-work preferences; real 25-credit welcome grant.
- [x] S1 Route-specific public metadata/canonicals, bounded titles, tool/analyser metadata and private dashboard noindex shipped in SEO release `0df1489` (details in SEO report).
- [ ] S2 Partial: category noindex, uncapped sitemap, single jobs H1, favicon, powered-by removal and logo alt shipped. Post-backfill crawl found one retired job still in the cached sitemap; explicit Full Route sitemap invalidation is prepared with the worker cache adapter and regression-tested, but must be deployed/live-verified before closing this task.
- [ ] S3 Complete truthful JobPosting coverage: acquire full source descriptions/original dates; do not invent salary/day units/GBP/expiry/company facts. Validate Google eligibility and expiry handling. Existing eligible listings have markup; snippets are withheld.
- [ ] S4 Split sitemap index; expired-job noindex/removal; canonical audit of every authenticated route.
- [ ] S5 Resolve single-hop HTTP canonical versus same-host HSTS-preload requirement; preserve HSTS flags on apex. No preload submission without subdomain audit.
- [ ] S6 Cache marketing HTML with a reviewed CSP policy scoped to nonce-requiring routes; retain strict authenticated CSP.
- [ ] S7 Measure mobile/desktop LCP <2.5s, CLS <0.1, INP <200ms with repeatable evidence; UK CV terminology throughout, unique useful metadata across all content.

## Phase 2 — ingestion, classification, dedupe, search, jobs UI

- [ ] I1 Move fetch > normalize > upsert connectors to container queues; dedicated allowed/scheduled/health/error `sources` table; recorded-fixture connector tests and per-source limits/robots compliance.
- [ ] I2 Reed, Adzuna, Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Teamtailor, Recruitee; Workday read-only career JSON; licensed RSS/XML/partner feeds and employer posting. Never scrape LinkedIn/Indeed.
- [ ] I3 Rules + structured-AI contract/permanent/fixed-term and off-topic gates; IR35 inside/outside/undetermined with confidence/evidence, never guessed; truthful GBP/day normalization without discarding actual unit/source facts.
- [x] I3a Decimal-rate migration 023 supplied; user confirmed SQL execution; production flag enabled; audited backfill applied 82 rates and retired 75 below-policy listings on 15 October. Fresh preview and exact-pence public verification follow below.
- [x] I3b Exact £35.98/hour publicly read back for job `7a37d4a7-8963-45b3-b8c9-a375fa458d71`; fresh signed preview scanned 5,184 active jobs with zero repairs and zero deferred decimals. Actual hourly unit preserved.
- [ ] I4 Normalized identity hash + pg_trgm; canonical job with many `job_sources`; source provenance and concurrent-ingestion tests.
- [ ] I5 Verified logos, Companies House number/SIC/size and agency/direct identity; listing-published business contacts only with source/time/removal process.
- [ ] I6 Recheck live source jobs every 12–24h; expire removals; sitemap/noindex propagation and source-health visibility.
- [ ] I7 Postgres FTS/skills GIN, pgvector/HNSW; weighted transparent skills/title/rate/location/workplace/IR35/clearance/availability match; persist factor breakdown/reasons and recompute on changes.
- [ ] B1 Four-column responsive pastel grid, infinite scroll, Best match/Newest/Highest rate, saved searches and alerts.
- [ ] B2 JobDrawer full highlighted description and matching skills, openings across cities, company/Companies House, lawful poster details, match breakdown; supported apply/external apply/tailor/save/not-interested actions.
- [ ] DB1 Normalize account `users_profile`, multi-persona `profiles`, companies/jobs/job_sources/sources/matches; migration/backfill/rollback plan and owner-RLS/index tests, no destructive replacement of existing history.
- [ ] W1 Dashboard keyword chips, all specified filter pills, credits, top five matches + Add URL/Apply all five; applications tabs All/Submitted/In flight/Needs you/Failed/Skipped; real data and approved safety gates.

## Phase 3 — CV pipeline and profile

- [ ] C1 PDFJS/mammoth + spacing normalization + structured extraction/validation; safe file limits, magic-byte checks and confirm-before-save.
- [ ] C2 Persona switcher/Add profile; A4 live CV editor, templates/fonts/sizes/fit-to-one-page/sections/Replace; accessible mobile layout.
- [ ] C3 Cover letter and details tabs; summary, education, experience, categorized skills, projects, certifications, custom sections/application defaults.
- [ ] C4 Evidence-only Honest/Aggressive tailoring; per-change diff accept/reject, version history, PDF/DOCX render/visual checks; no invented experience.
- [ ] C5 ATS parseability/keywords/quantified-impact/length/UK-spelling score with factor fixes and reviewable Improve with AI.
- [ ] C6 Job-specific completion modal showing only required fields; correct deep links to missing values.
- [ ] C7 OpenAI JSON-schema wrapper with versioned prompts, per-user costs and profile-fact rejection validator.
- [ ] DB2 Migrate `cv_versions`, per-persona history and job references without leaking private CV objects.

## Phase 4 — apply engine, adapters, needs_info, credits

- [ ] E1 Harden Phase 0 lifecycle with atomic transitions/events, unique user/job guard, idempotency, recovery and stored Realtime state.
- [ ] E2 `supports`/`apply` adapters for Greenhouse/Lever/Ashby/Workable/SmartRecruiters/Teamtailor/Workday/generic; official API where available, otherwise stable-selector Playwright/human pacing; mock ATS contract tests.
- [ ] E3 Profile -> saved answer -> evidence-only AI per question; unknown -> needs_info asking one question; length-safe answers, resume/retry only with authorization.
- [ ] E4 Relay/connected-mail OTP/link wait up to five minutes; no CAPTCHA solving; encrypted portal sessions; no unsupported aggregator “success”.
- [ ] E5 Per-user caps, per-employer rate limits, kill switch, duplicate guard, audit/failure details and screenshots expiring at 30 days; Sentry scrubbing.
- [ ] E6 Normalized saved_answers, memories, applications/events; worker-only service role and narrow web command boundary; RLS/privilege regression tests.
- [ ] E7 Durable credit grant/consume/refund-on-failure ledger and idempotency; real 25-application sign-up grant; never double-consume on retries.

## Phase 5 — relay mail and tracker

- [ ] M1 Configure/verify mail.ir35careers.com MX (Postmark/SES/Cloudflare choice), inbound signatures/idempotency/raw MIME Storage/parse/category/OTP/link/date/application linkage/status transition.
- [ ] M2 Forward to user's actual email and web push; scoped read-only Gmail/Outlook verification integration; verify both paths without exposing unrelated mail.
- [ ] M3 Outbound Compose/reply via verified Postmark/Resend; SPF/DKIM/DMARC, message threading and bounce states.
- [ ] M4 Private email selector/card: active/forwards-to/OTP explanation/use-own-email; two-pane responsive inbox, specified category chips, pagination/search/mark-read/Compose.
- [ ] M5 Archive/junk/trash/delete/restore/star/read actions persist; marketing segregation; no mobile navigation/support collisions; accessible message logos/links.
- [ ] T1 Pipeline Sankey + draggable kanban (Applied/Ghosted/Interviewing/Rejected/Offer); Add application and CSV import/export with validation.
- [ ] DB3 Normalized email_messages, raw/html references and retention/access tests; preserve inbox history and privacy-safe audit logs.

## Phase 6 — lanes, scheduler, chat, alerts

- [ ] U1 Auto Apply hero, grounded profile/jobs chat; “what would apply” and CV readiness explanations, never fabricated job/user facts.
- [ ] U2 Persist lanes: role/skills/location/rate/IR35/minimum match/daily cap/permission date/enabled; scheduling N times per day within caps/credits.
- [ ] U3 Lane run tailors, auto-approves only within consent or queues for review; summary notification, pause/kill and per-run metrics.
- [ ] U4 Saved-search instant/daily/weekly email and web push; PECR-compliant unsubscribe/preferences. WhatsApp/Twilio remains explicitly later.
- [ ] DB4 Lanes and saved_searches migrations, schedule locks, tenant isolation and deterministic mocked-clock tests.

## Phase 7 — billing, extensions, mobile/admin

- [ ] P1 Stripe Starter £15/150, Pro £29/400, Power £59/1,000 + Auto Apply; monthly/quarterly -20%/annual -35%; Checkout/Portal and live-price/legal release gates.
- [ ] P2 Idempotent subscription webhooks, period entitlement/credit grants/refunds; referral 25 each with anti-abuse/idempotency and ledger.
- [ ] N1 Lawful public or user-added contacts at applied-to companies; reviewed draft outreach only, never automatic sending; provenance/removal.
- [ ] R1 Research CMS/editorial IR35 guides, source-reviewed UK content and unique SEO; no random invented legal/tax advice.
- [ ] K1 Workday/ATS account explicit opt-in, tenant binding and encrypted Vault/libsodium secret references; revocation/delete/rotation and no secrets in UI/logs.
- [ ] K2 Settings: Off/Honest/Aggressive/auto-approve/review, editable memories, public portfolio, ATS vault, job boards, billing, referrals, scoped email integrations, notifications and account export/delete.
- [ ] AD1 Admin source health, queue depth, ATS success rate/failure reasons, least-privilege administrator invitation/removal and contractor CV view/download with access audit.
- [ ] AD2 Real mobile layout/device regression for admin tables/drawers/search and all workspace screens, onboarding tour, support presence and bottom safe areas.
- [ ] G1 UK GDPR record of processing, export/delete, AI disclosure and automated 30-day screenshot cleanup; processor/data-retention inventory and verified deletion tests.

## Release discipline / manual dependencies

- [ ] Every task: strict TS; new boundaries use Zod; no client secrets or unexplained RLS/CSP changes; relevant Vitest + mock-ATS Playwright + recorded connector fixtures.
- [ ] Every PR: one concern, what/why, screenshots where applicable, tests, migrations, environment names, manual Supabase/Vercel/DNS/Stripe/mail/Google steps and safe production verification using the named test account. Attach created PRs to this chat.
- [x] Persistent host/queue choice resolved: Railway + existing Supabase pg-boss session pooler. Original prepare-only restriction is superseded by the end-to-end instruction above. Standby deployment is authorized; production runner/accept-jobs cutover still requires **YES CUTOVER**.
- [ ] Confirm custom auth-domain DNS/provider steps, mail provider/MX/SPF/DKIM/DMARC and Stripe products/prices in the owner's accounts; never request pasted passwords/tokens.
- [ ] Final live audit and release report; all phases remain active until implemented and verified, not merely planned.

## Evidence log

- 15 October: `0df1489` production build ready; 471 unit tests/199 legacy checks. Existing SEO audit covered 154 non-job routes + 40 sampled jobs; final post-backfill crawl pending.
- 15 October 06:24 UTC: signed read-only application report scanned 78 packets; six provider-confirmed, 36 needs-user, four approved-without-submission; no automatic pending tasks. Incident job has employer-login attention, no receipt. No real application submitted by this audit.
- 15 October: decimal repair preview: 5,259 active rows; 75 below-policy/off-topic, 82 rate corrections, zero deferred decimals. Hash-bound apply: 157 writes, zero concurrent skips. Retired records are recoverable from moderation audit, not hard-deleted. Follow-up scanned 5,184 active rows: zero changes/deferred decimals. Public API returned GBP 35.98–35.98 hourly for the Design Engineer fixture. Other near-duplicate listings with differing source text remain a Phase 2 canonical-dedupe task; zero conservative repair candidates is not proof of zero duplicates.
- 15 October: Railway preparation in branch codex/railway-apply-worker; full Vitest run passed **486 unit tests/108 files**, with TypeScript/ESLint and **199 legacy checks** passing; six Playwright mocked-browser boundary tests passed. Next production build succeeded; real pg-boss constructor accepts the validated settings without connecting. Docker build and live database/queue integration remain owner verification gates, not claimed complete. No Railway CLI/account calls, queue setup, SQL 024 execution or runner flag change made. Prepare-only Railway branches disable Vercel Git deployment to avoid accidental previews on push. Draft PR #1 is stacked on an explicit release snapshot to avoid mixing the already-deployed SEO commits into the worker diff.
- 15 October: post-backfill public crawl found one retired job advertised by the stale sitemap (other checked metadata passed); Data/CDN cache purge did not resolve Full Route snapshot. Reopened S2 rather than reporting a false clean audit. No new production code deployed during Railway preparation.
