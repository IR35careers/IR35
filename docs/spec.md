# IR35Careers product specification

Preserved verbatim from the user-provided brief, 15 October 2026. Implementation status belongs in progress.md, not in edits that weaken this specification.

MISSION
Build the UK's best platform for contract jobs, both Inside and Outside IR35. In one place, users can:
- find every live UK IR35 contract, with the full description, day rate, IR35 status, company details, who posted it, and a match % against their profile
- tailor their CV and cover letter for each job
- apply in one click, or let Auto Apply do it
- receive all application email in a private IR35Careers inbox, forwarded to their own email
- track every application, get alerts, and score and improve their CV
The product model is Tsenta ("Apply to every job that fits you, automatically"), adapted for UK contractors. Use UK English everywhere: CV not Resume, £, day rate.

2) DESIGN SYSTEM
- shadcn/ui in /components/ui, lucide-react icons, Framer Motion, Recharts. Lexend for headings and UI, Inter for body.
- Colours: ink #0B0F0E (primary buttons), forest #0F3D2E (brand), emerald #10B981 (Outside IR35 / success), rose #E11D48 (Inside IR35), amber #F59E0B (needs you), sky #0EA5E9 (info).
- Job-card pastels, rotated: mint #E8F7EE, peach #FDEBDD, sky #E6F1FD, lilac #F1E8FD, butter #FFF6D6.
- Radius: cards 12, inputs 8, pills full. Spacing on a 4px grid. Calm, premium, airy. Light theme plus dark mode.
- WCAG 2.2 AA: all text at least 4.5:1 contrast (fix today's faint captions and pink-on-pink badges), visible focus, full keyboard use, prefers-reduced-motion respected.
- Shared components:
  - IR35Badge: Outside / Inside / Not stated, with confidence and a "Why" popover quoting the listing.
  - MatchRing: 0-100, coloured by band.
  - JobCard: pastel; shows location, posted age, ring, title, skill chips, logo, Pass / Apply.
  - JobDrawer, StatusPill, EmptyState (one sentence + one action), Skeletons.
- App shell:
  - Top nav: Dashboard, Browse jobs, Auto Apply, Tracker, Networking, Profile, Research; on the right, Settings, a credits pill ("25 left") and the avatar.
  - Mobile: a bottom tab bar.
  - Settings and Profile sub-navigation use the owner's two-level sidebar component (/components/ui/sidebar-component.tsx, @carbon/icons-react, softSpringEasing cubic-bezier(0.25,1.1,0.4,1)). Replace its demo content and the "Interfaces" brand, and make it collapse into a sheet on mobile.

3) SCREENS
- Landing (/):
  - Sky-gradient hero: "Every UK contract. Inside and Outside IR35. Applied for you." CTAs: Start free, Browse contracts. Product screenshot underneath.
  - Live stats from the DB: roles, sources, average day rate.
  - How it works (3 steps), features, free IR35 checker and take-home calculator, pricing, FAQ, footer.
- /account:
  - Split screen. Left: the pitch and 3 ticks. Right: Continue with Google, or email.
- Onboarding (first sign-in, resumable stepper):
  - How did you hear about us (LinkedIn, Google, ChatGPT/AI, Reddit, Friend, Recruiter, Forum, Other).
  - CV upload, with parse progress and confirm.
  - Preferences: roles, skills, locations / remote / hybrid, minimum day rate, IR35 preference, Ltd / umbrella / PAYE, availability, clearance (None/BPSS/SC/DV), right to work.
  - Welcome: "You have 25 free applications", button: Browse jobs.
- Dashboard:
  - A keyword chip search bar.
  - Filter pills: date, location, workplace, IR35, rate, clearance, duration, company, seniority, source.
  - Credits banner.
  - Top 5 matches row, with Add your own (job URL) and "Apply to all 5".
  - Applications table with tabs: All / Submitted / In flight / Needs you / Failed / Skipped.
- Browse jobs:
  - A 4-column pastel grid, infinite scroll, sort by Best match / Newest / Highest rate, saved search + alert.
  - The drawer shows:
    - the full description, with the user's keywords highlighted
    - skills, highlighting the ones the user has
    - "N openings" across cities
    - About the company, including the Companies House number
    - Posted by (agency or direct; business contact only if the listing publishes it)
    - a match breakdown with reasons
    - actions: Apply with IR35Careers (when supported), Apply on employer site, Tailor CV, Save, Not interested
- Auto Apply:
  - Power hero.
  - AI chat on the left, using the user's real profile and jobs ("What would it apply to for me?", "Is my CV ready?").
  - On the right: lanes (role, skills, location, rate, IR35, minimum match %), a daily cap, and a permission checklist.
- Tracker:
  - Inbox: a 2-pane mail client with colour chips (All / Verification / Rejection / Interview / Assessment / Reminder / Offer / Applied), the relay address selector, Compose, Mark all read, search and pagination.
  - A private email card: "Active email… Forwards to… We auto-fill OTPs from both inboxes. Use my email instead".
  - Pipeline: a Sankey chart (Applied > Ghosted / Interviewing / Rejected / Offer) above a drag-and-drop kanban, with Import/Export CSV and Add application.
- Networking: people at companies the user applied to (lawful public sources or user-added only), plus drafted outreach. Never auto-send.
- Profile:
  - Persona switcher (e.g. "DevOps Engineer - default"), with Add profile.
  - Tabs: CV (a live A4 editor with template, font, size, fit to one page, sections, Replace, Download PDF/DOCX) / Cover letter / Profile details.
  - Profile details: summary, education, experience, skills by category, projects, certifications, custom sections, application defaults.
  - A CV score panel (0-100) with fixes and "Improve with AI": changes are accepted one by one, and it never invents experience.
  - A "Complete your profile" modal that shows only the fields a job needs.
- Research: a blog for IR35 and contracting guides.
- Settings sections:
  - Apply settings: CV optimisation Off / Honest / Aggressive, Auto-approve, Review before submit.
  - What IR35Careers remembers (editable).
  - Public portfolio.
  - ATS accounts (encrypted vault).
  - Job boards.
  - Plans & billing.
  - Referrals.
  - Email integrations: Gmail/Outlook, read-only and scoped to verification mail.
  - Notifications.
  - Account: export / delete.
- Pricing (GBP): billed monthly, quarterly (-20%) or annually (-35%).
  - Starter £15: 150 applications/month.
  - Pro £29, most popular: 400/month.
  - Power £59: 1,000/month + Auto Apply.
  - 25 free applications on sign-up. Stripe Checkout + Portal.

4) BACKEND SERVICES
- web (Vercel): UI, server actions and light APIs only. No long jobs.
- worker (Fly.io or Railway container): Node, Playwright + Chromium, and pg-boss or BullMQ (Upstash Redis). Queues: ingest, enrich, match, tailor, apply, mail, alerts. Crons only enqueue work.
- mail: mail.ir35careers.com, with MX to Postmark Inbound (or SES / Cloudflare Email Workers).
  - Inbound webhook: store the raw MIME in Storage, parse, classify, extract OTPs/links/dates, link to the application, update the status (e.g. interview > Interviewing), forward to the user's email, and send a push.
  - Outbound replies go via Postmark/Resend with SPF, DKIM and DMARC.
- ai: an OpenAI wrapper with JSON-schema outputs, versioned prompts, per-user cost tracking, and a validator that rejects facts not in the profile.

5) CORE LOGIC
- Ingestion (IR35 contracts only):
  - Plugin connectors, each running fetch > normalise > upsert. Each source is listed in a `sources` table with an allowed flag, schedule and health.
  - Allowed sources: Reed API; Adzuna API; Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Teamtailor and Recruitee public job APIs; Workday public career-site JSON (read-only); agency RSS/XML feeds; employer-posted jobs; licensed partner feeds only for Indeed and LinkedIn.
  - NEVER scrape LinkedIn or Indeed.
  - Respect robots.txt and rate limits.
- Classifiers, all rules + LLM:
  - contract vs perm (keep contract, optionally fixed-term)
  - off-topic category filter
  - IR35 {inside | outside | undetermined, confidence, evidence_quote}; never guess
  - day-rate normaliser to rate_min/rate_max, GBP per day, or "Rate not stated"
- Dedupe: a normalised hash + pg_trgm fuzzy matching. One canonical job with many job_sources rows.
- Enrichment: logos, Companies House API, agency vs direct.
- Poster contacts: stored only when the listing publishes them, with source and timestamp (UK GDPR legitimate interests; honour removal requests).
- Re-check jobs every 12-24h. Expire removed jobs, and drop them from the sitemap with noindex.
- Search: Postgres full-text + pgvector embeddings.
- Match score: a weighted mix of skills (taxonomy + embeddings), title, rate fit, location/workplace, IR35 preference, clearance and availability. Store the per-factor breakdown and reasons, and recompute when the job or profile changes.
- CV pipeline:
  - Parse with pdfjs + mammoth, normalise spacing, then structured LLM extraction, then validation.
  - Tailor per job, Honest or Aggressive, using evidence from the profile only. Show a diff with accept/reject.
  - Render to PDF.
  - Score against: ATS parseability, keywords, quantified impact, length, UK spelling.
- Apply engine. Statuses: draft > needs_profile > awaiting_approval > queued > submitting > submitted | needs_info | failed | external_only | skipped.
  - Status only moves forward, except through an explicit Retry. Every transition writes an application_events row (with failure_reason, error_detail and a step screenshot kept 30 days).
  - The UI reads the stored status via Realtime.
  - ATS adapters (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Teamtailor, Workday, generic form) implement supports(job) and apply(job, packet). Use the official apply API where one exists; otherwise Playwright with stable selectors and human pacing.
  - Question answers come from profile fields, then saved answers, then the LLM (profile facts only). Each question is answered on its own and length-safe. An unknown answer pauses as needs_info, asking the user one question.
  - OTPs and links come from the relay inbox or the connected mailbox; wait up to 5 minutes.
  - Workday accounts: only with explicit opt-in, with credentials encrypted (Supabase Vault/libsodium).
  - Safety: no captcha solving (pause instead), per-user daily caps, per-employer rate limits, a duplicate guard, a kill switch, and audit logs.
  - Reliability: a 15s heartbeat; a watchdog fails jobs stuck submitting for over 10 minutes with reason runner_timeout; up to 2 retries on transient errors; Sentry.
- Auto Apply: lanes run N times a day, within the cap and the user's credits. Each run tailors, then auto-approves or queues for review, and sends a summary notification.
- Alerts: saved searches send email digests (instant/daily/weekly) and web push. WhatsApp via Twilio comes later. Unsubscribe must be PECR-compliant.
- Billing: Stripe webhooks > subscriptions; a credits_ledger (grant / consume / refund on failure); referral bonus of 25 applications each.

6) DATA MODEL (RLS on every user table; the service role only in the worker)
- users_profile(id, full_name, phone, location, right_to_work, clearance, availability_date, notice_period, min_day_rate, ir35_pref, engagement_type, heard_from, onboarding_step, relay_address, forward_to, plan)
- profiles(id, user_id, name, is_default, summary, skills, experience, education, projects, certifications, custom_sections)
- cv_versions(id, profile_id, job_id, file_path, text, parsed, score, score_breakdown, mode)
- saved_answers(user_id, question_hash, question_text, answer)
- memories(user_id, content)
- companies(id, name, domain, logo_url, companies_house_no, sic, size, is_agency)
- jobs(id, slug, title, company_id, description_html, description_text, location, lat, lng, workplace, contract_length, rate_min, rate_max, ir35_status, ir35_confidence, ir35_evidence, clearance, seniority, skills[], embedding, posted_at, valid_through, status, apply_type, ats, ats_job_url, poster_name, poster_email, poster_phone, poster_source)
- job_sources(job_id, source, external_id, url, fetched_at, raw)
- sources(name, type, allowed, schedule, last_run_at, health, error)
- matches(user_id, job_id, profile_id, score, breakdown)
- lanes(user_id, name, filters, min_match, daily_cap, enabled, permission_granted_at)
- applications(user_id, job_id, profile_id, cv_version_id, cover_letter, answers, status, failure_reason, error_detail, ats, submitted_at, external_ref; unique on user_id + job_id)
- application_events(application_id, from_status, to_status, message, screenshot_path)
- ats_accounts(user_id, ats, tenant, username, secret_ref)
- email_messages(user_id, application_id, direction, from, to, subject, text, html_path, category, otp, links, received_at, read)
- saved_searches(user_id, query, frequency, last_sent_at)
- subscriptions(user_id, stripe_customer_id, plan, status, period_end)
- credits_ledger(user_id, delta, reason, application_id)
- referrals(referrer_id, referred_id, status)
- Indexes: GIN on job FTS and skills; HNSW on embeddings; (user_id, status) on applications.

7) SEO AND PERFORMANCE
- Titles: unique, 60 characters or fewer. Meta descriptions: unique. Canonicals on every page; /tools/* and /analyse-job currently copy the homepage's.
- Noindex /dashboard and every authenticated route, plus empty contract landing pages (15 of 120 are empty now).
- Full JobPosting JSON-LD on every live job: CONTRACTOR, baseSalary per DAY in GBP, validThrough, hiringOrganization, location or TELECOMMUTE.
- A split sitemap index with expired jobs removed. One H1 per page (/jobs has two).
- Add /favicon.ico. Remove X-Powered-By. Redirect in a single hop to https://www. HSTS with preload on the apex.
- Cache marketing pages; scope the CSP nonce to where it's needed.
- Core Web Vitals targets: LCP under 2.5s, CLS under 0.1, INP under 200ms.
