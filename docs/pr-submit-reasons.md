# P0.8 — explain disabled Submit and Auto Apply actions

## What / why

Replace unexplained disabled actions with exact, actionable client-known reasons. Submit lists missing essential contact/CV information, each empty/unreviewed required question by its real label, final approval, busy/in-flight or skipped state. Its button and click guard share the same reason builder. Auto Apply similarly shares its actual busy/paused/permission gates with a live explanation. Neither list fabricates employer eligibility, credits, matching jobs or confirmed authentication.

Remedies focus the question, current application CV editor, approval, Auto Apply switch or permission control. Contact links open the exact profile field with the saved job return context. A validated application-return detour uses application essentials, so unrelated optional profile completion no longer prevents Continue. General profile completeness and its full setup-completed policy remain unchanged.

## Evidence / screenshots

- **629 unit tests/119 files, all 199 legacy checks, TypeScript and ESLint pass.** Includes 31 focused reason-builder cases and all 12 Auto Apply gate combinations.
- Isolated production build + **12 browser cases pass** across phone/tablet/desktop: nine P0.8 journeys and three native P0.7 approval cases. A final capture refresh reran all nine P0.8 cases successfully. Exact missing fields, native focus, CV repair, profile save/return, gate removal and zero submission requests are asserted. No new skips or force clicks.
- Scoped Axe scans of both new panels found no serious/critical violations. Real Essential only UI choice fixes a malformed test consent fixture that intercepted one initial desktop click; no overlay was hidden and no accessibility exemption was added.
- Reviewed fictional-preview screenshots: [application](https://github.com/IR35careers/IR35/blob/codex/railway-submit-reasons/docs/screenshots/p0-8/application-desktop.png), [Auto Apply](https://github.com/IR35careers/IR35/blob/codex/railway-submit-reasons/docs/screenshots/p0-8/automation-desktop.png). Full screenshots include existing fixed navigation/support at capture positions; they are not visual-baseline replacements.
- Dependency audit passes with only the two existing owner-approved, exact-ID/version exceptions expiring 29 October; no new waiver. Final-head CI remains required before merge.

See `incident-disabled-actions.md` for baseline causes and boundaries. No browser persistence test here claims hosted Supabase Realtime proof.

## Migrations / environment / manual steps

None for this patch. No RLS/CSP weakening, new dependency, secret, billing, runner flag or live data mutation. No Supabase/Vercel/DNS/Stripe/Postmark/Google action by this PR. Existing **025/compatible web-release hold** and **Railway 2 GB account-capacity gate** remain; no production release/cutover is implied by merge. Authentication/callback/confirmed-email work remains P0.9.

## Production verification / rollback

After the coordinated compatible release, use anvesh.mannuru+ir35test@gmail.com with a controlled **mock ATS only**. Remove a phone/required answer, confirm the exact list, use each remedy and return, verify missing entries disappear and approval still resets on material edits. Toggle Auto Apply and permission independently; each current disabled reason must remain visible and navigable. Never test by submitting to a real employer. Source-only rollback is reverting this patch; no database rollback or queue deletion is needed. Phases 0–7 remain active, not reduced to this slice.
