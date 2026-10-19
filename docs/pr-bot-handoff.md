# Human-controlled Grok/Codex handoff

## What changed

Direct owner-requested repository setup, not an automatically handed-off bug. Adds issue forms, 19-label manifest, a draft PR template, IR35careers CODEOWNERS, bot-specific AGENTS rules, code/preview checks, metadata/result sync and bounded stale-issue cleanup. No API-key Codex Action, automatic Codex comments, approvals/merges, production release or new paid service.

Uses a separately created empty Hobby mock-preview project, never production environment copies. Root static vercel.json preserves live configuration/holds and blocks bot branches there. The new project uses Root Directory bot-preview, source files outside the root enabled and a separate static config with no crons/queue trigger. Guarded builds copy only real application source/assets and reject wrong project identity, application credentials and env files; auth/apply/mail/worker/importer APIs are disabled in mock mode, with self-only browser connections. The project remains Git-disconnected/protected and preview automation disabled until owner activation.

An initial programmatic Git gate failed: the first push started existing-project non-production preview dpl_CfZB7RyUvUFcMLJW35unygZASL5c. It was canceled and read back CANCELED. Programmatic early gating is removed, not represented as effective isolation or proof of no network access during that canceled build.

## Risk and gates

Security/workflow/deployment boundary: manual human review required. No migration, RLS change, dependency change, production secret/data/env change, worker acceptance or cutover. Existing CSP is unchanged outside the dedicated mock flag. Mock builds reject unknown project identities. Credential isolation is not a network firewall against arbitrary malicious code.

Main protection is installed: strict required GitHub Actions pr-checks, one approval/code-owner review, admins included, stale approval dismissal, conversation resolution, no force push/deletion. Auto-merge remains off. CODEOWNERS takes effect after this PR merges. IR35careers authored this bootstrap PR and cannot self-approve; another existing authorised human reviewer is needed for bootstrap. Do not bypass protection or auto-merge.

## Test plan

Initial source: 912 unit tests/138 files, 199 legacy checks, strict types/lint pass; root-based mock production build and four desktop/mobile preview-render + actual intercepted mock-ATS engine tests passed. These do not prove the revised separate-root build; its verification is recorded separately in docs/progress.md. YAML parses. Source/history scan passed for 732 tracked files. Dependency audit retains only two pre-existing exact exceptions expiring 29 October; no new waiver. Hosted Cloud/Vercel/Grok workflow remains unverified.

Final revised source: **914 unit tests/138 files, all 199 legacy checks, strict types and zero-warning lint pass**. Separate-root build and native Next production server pass, with all four phone/desktop read-only UI and mock-ATS tests passing in 21.2s. Source/history scan passes for 734 tracked files. First-head CodeQL's comment-parser alert was fixed with conservative line/state parsing, not waived; final-head CI is still required. Manifest-lock consistency and fresh issue-state revalidation are covered. The first shared-TS-config runtime import failure is fixed with build-time transpilation to a generated local CJS config.

After manual merge, follow docs/bots.md: connect only the empty ir35-bot-preview project, review its mock-only flags/system ID/Node22/protection, configure public preview variables, and use one harmless P1 UI issue to verify current-SHA draft/preview/smoke/comment/label behaviour. Preview URL is deliberately not invented: no hosted deployment exists yet. Use only anvesh.mannuru+ir35test@gmail.com and mock ATS; never submit to employers or use customer data. Verify a new commit clears old preview labels; a stale/foreign/production URL or needs-human PR cannot pass. Confirm actual FAIL stops the handoff once and needs-human stays until owner review.

## Screenshots

No product redesign in this PR. Existing UI was exercised on phone/desktop in mock mode. QA must attach redacted evidence for the controlled hosted test after activation; no screenshot is represented as hosted proof.

## Manual setup

docs/bots.md includes exact Codex Cloud/GitHub-review setup, scripts, issue-comment fallback and common/QA-only messages to paste into all five Grok Bots. No authenticated Cloud/Grok settings connector is available here, so those account settings are unverified/not changed. Grant only this repo and issue/comment access, never approval/merge rights; no key purchase or upgrade.

Only new preview-target public flags: IR35CAREERS_E2E_DEMO_DATA, IR35CAREERS_BOT_PREVIEW. Public repository variables: BOT_PREVIEW_PROJECT_PREFIX; BOT_PREVIEW_ENABLED remains false until controlled verification. No new Actions secret. Main/default-branch workflows and forms activate only after owner merge. Existing open PRs may need an update/re-run for the newly required check. No production action is included in this verification plan.
