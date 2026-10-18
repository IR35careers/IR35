# P0.8 — unexplained disabled application actions

## Checked baseline

At `f817838`, `ApplicationRecordWorkspace` disabled Submit for busy/in-flight, unreviewed answers or incomplete approval, but rendered only a generic cloud-processing paragraph beside it. The contractor could not identify the unanswered question from the disabled button. `AutomationSettings` similarly disabled Apply to next match now for busy, paused or missing permission without listing the active reasons. The profile's return link additionally required full `evaluateProfileReadiness`, even though the submission API requires only the application essentials; unrelated optional profile details could prevent return to the saved application.

## Change

- `applicationSubmitBlockers` lists every empty/unreviewed required question by label, final approval, missing essential contact/CV data, each busy state, in-flight status or skipped state. It uses the same name/email fallbacks and essential-field evaluator as the server, not an arbitrary completion percentage.
- The primary button and its click guard use the same blocker result. Descriptions are connected with `aria-describedby`; the polite live list has links/buttons to the actual question, current application CV editor, final approval or exact profile field. These explanations do not grant permission or alter stored delivery state.
- Auto Apply's actual busy/paused/consent conditions share a reason builder with its disabled button and click guard. Actions focus the switch or permission control, including navigating back to Matches when necessary.
- A validated application-return context shows only essential readiness on the profile detour. General profile completeness and the full profile-setup-completed policy are unchanged. Employer-specific declarations remain separate required questions; none are invented or bypassed.

Client checks do not predict employer support, available credits, confirmed authentication or account-specific server eligibility. Existing server ownership, approval, lifecycle and submission checks remain authoritative. Authentication/callback and confirmed-email work remains P0.9; this patch does not claim it complete.

## Verification

Thirty-one focused reason-builder cases pass, including all 12 Auto Apply condition combinations, exact question labels, missing essentials/deep links, invalid technical-heading names, CV-editor remedy, optional-profile exclusions, all busy states, queue/submitting/skipped states and no mutation/approval while explaining. Full local verification passes **629 unit tests/119 files + 199 legacy checks, strict types/lint**. Final browser/production and exact-head CI evidence is recorded in progress.md; no hosted release is inferred from these tests.

## Operations / privacy

No migration, credential, billing, RLS, CSP or runner-flag change. No real employer submission. Migration 025 and a compatible web release remain prerequisites for production verification; Railway is held at the account's 1 GB capacity ceiling. Full phases 0–7 remain the objective.
