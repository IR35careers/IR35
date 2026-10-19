# Full supplied job text, truthful excerpts and mobile disclosure

## What and why

Phase 0 P0.10: replace fixed-height/nested description scrollboxes and inconsistent full-advert promises with shared plain-text/native disclosure across job details, application preparation/Contract tab, external analyser and CV review. Keep all supplied text and wrap long tokens. Preserve original and role-details actions. Source excerpts, missing descriptions and safe import limits get explicit notices instead of invented completeness.

Keep the existing 100,000-character external import cap, but never cut mid-word/surrogate. Carry known excerpt/import quality in memory; known excerpts/limits do not qualify for JobPosting. No database migration. A new legitimate large-input regression uncovered quadratic rescanning in the existing rate extractor; sentence-boundary anchoring fixes it without increasing test timeouts or relaxing currency/period evidence. See incident-job-description.md.

## Tests and screenshots

- 57 focused unit checks and final full **810 unit/131 files + all 199 legacy, TypeScript/ESLint pass**. Source/history and dependency audits pass with only the two pre-existing owner exceptions expiring 29 October, no new waiver.
- Isolated production build and all 12 phone/tablet/desktop cases pass: native touch/Enter/Space, source tail/word wrapping, no horizontal overflow, honest summary/missing/limit, escaped content and original link, job/application tabs/reload and pre-preparation disclosure. No real employer or credentials. No new skip, visual tolerance/baseline or accessibility exemption.
- A second fresh production build and all 12 cases also pass with persisted captures. Reviewed fictional screenshots: [phone](screenshots/p0-10/description-mobile.png) and [desktop](screenshots/p0-10/description-desktop.png). Final-head CI remains required.

## Manual and release gates

No new environment variables, migration, RLS/CSP changes, paid service, Supabase/Vercel/DNS/Stripe/Postmark/Google configuration or runner/cutover mutation. `description_kind` is optional in-memory import metadata, not a database field. Existing official Reed detail recovery and SSRF/import byte cap remain. Full source acquisition/Google Jobs coverage is still S3/I2, not fabricated by a UI fix.

PR #30's offline Oracle planner is independently merged. This PR is one description concern, not a worker deployment. Production remains held pending compatible migration 025/web rollout. Oracle account/eligibility, worker health, provider-auth preview and YES CUTOVER gates remain open. Later production verification uses only mock ATS and anvesh.mannuru+ir35test@gmail.com; do not apply to real employers.

## Rollback

Revert this source change and restore the prior reviewed web version if necessary. No data backfill or destructive rollback needed. Keep the current production Vercel runner and acceptance gates unchanged.
