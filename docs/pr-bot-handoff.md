# Human-controlled Grok/Codex handoff

## What changed

Direct owner-requested repository setup, not an automatically handed-off bug. Adds issue forms, 19-label manifest, a draft PR template, IR35careers CODEOWNERS, bot-specific AGENTS rules, code/preview checks, metadata/result sync and bounded stale-issue cleanup. No API-key Codex Action, automatic Codex comments, approvals/merges, production release or new paid service.

Uses a separately created empty Hobby mock-preview project, never production environment copies. Programmatic vercel.ts chooses the exact new project by system ID; vercel.base.json preserves the live configuration/holds and blocks bot branches there. Mock builds reject application credentials and env files; auth/apply/mail/worker/importer APIs are disabled in that project, with self-only browser connections. The project remains Git-disconnected/protected and preview automation disabled until owner activation.

## Risk and gates

Security/workflow/deployment boundary: manual human review required. No migration, RLS change, dependency change, production secret/data/env change, worker acceptance or cutover. Existing CSP is unchanged outside the dedicated mock flag. Unknown project identities default to the held live configuration. Credential isolation is not a network firewall against arbitrary malicious code.

Main protection is installed: strict required GitHub Actions pr-checks, one approval/code-owner review, admins included, stale approval dismissal, conversation resolution, no force push/deletion. Auto-merge remains off. CODEOWNERS takes effect after this PR merges. IR35careers authored this bootstrap PR and cannot self-approve; another existing authorised human reviewer is needed for bootstrap. Do not bypass protection or auto-merge.

## Test plan

Local: 911 unit tests/138 files, 199 legacy checks, strict types/lint pass; guarded mock production build and all four desktop/mobile read-only-preview + actual mock-ATS engine tests pass. Final sticky needs-human handling has a subsequent focused 15-test pass. YAML parses. Source/history scan passes for 731 tracked files. Dependency audit retains only the two pre-existing exact exceptions expiring 29 October; no new waiver. Hosted Cloud/Vercel/Grok workflow is not proven by these local results.

After manual merge, follow docs/bots.md: connect only the empty ir35-bot-preview project, review its mock-only flags/system ID/Node22/protection, configure public preview variables, and use one harmless P1 UI issue to verify current-SHA draft/preview/smoke/comment/label behaviour. Preview URL is deliberately not invented: no hosted deployment exists yet. Use only anvesh.mannuru+ir35test@gmail.com and mock ATS; never submit to employers or use customer data. Verify a new commit clears old preview labels; a stale/foreign/production URL or needs-human PR cannot pass. Confirm actual FAIL stops the handoff once and needs-human stays until owner review.

## Screenshots

No product redesign in this PR. Existing UI was exercised on phone/desktop in mock mode. QA must attach redacted evidence for the controlled hosted test after activation; no screenshot is represented as hosted proof.

## Manual setup

docs/bots.md includes exact Codex Cloud/GitHub-review setup, scripts, issue-comment fallback and common/QA-only messages to paste into all five Grok Bots. No authenticated Cloud/Grok settings connector is available here, so those account settings are unverified/not changed. Grant only this repo and issue/comment access, never approval/merge rights; no key purchase or upgrade.

Only new preview-target public flags: IR35CAREERS_E2E_DEMO_DATA, IR35CAREERS_BOT_PREVIEW. Public repository variables: BOT_PREVIEW_PROJECT_PREFIX; BOT_PREVIEW_ENABLED remains false until controlled verification. No new Actions secret. Main/default-branch workflows and forms activate only after owner merge. Existing open PRs may need an update/re-run for the newly required check. No production action is included in this verification plan.
