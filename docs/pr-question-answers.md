# Keep application answers question-specific and sentence-safe

## What and why

Phase 0 reported identical AWS/Azure answers ending in `Azure (AKS,`. Select evidence per question before limiting it; stop copying/truncating a shared CV line. Match only a unique reviewed normalized question, preserve C/C#/C++/.NET identities, and do not borrow generic substring answers. Text fields within one fieldset must retain their own labels.

Capture employer maxlength and enforce it before browser filling. Keep fitting answers unchanged; shorten narrative answers only at complete, balanced sentence boundaries. Otherwise request review. Never shorten names, contact details or other atomic facts. See `docs/incident-form-answers.md` for code paths, synthetic reproduction and limitations.

## Tests and screenshots

Exact local and final-head results are in `docs/progress.md`. Unit regressions exercise independent cloud evidence, long lines, missing evidence, boundaries/parentheses, conflicting saved answers and C-family collisions. Chromium mock ATS checks distinct field labels/lengths and both confirmed mock receipt and zero-submission needs-user outcomes across all three projects. No visual layout redesign or screenshot baseline change; no accessibility assertion or platform skip is loosened.

## Migrations, environment, manual verification

None. No new dependency, variable, secret, migration, RLS/CSP change or provider setup. Synthetic CVs, mock ATS and labelled preview only. After the authorized compatible release, use `anvesh.mannuru+ir35test@gmail.com` to prepare a draft with separate AWS/Azure evidence; inspect each answer and switch tabs/reload without applying to a real employer. The full tab-persistence task is separate, not claimed fixed by this PR.

Vercel Git deployment remains held: parent lifecycle code needs the verified encrypted backup and coordinated migration/web release. Worker acceptance/producer cutover still requires literal **YES CUTOVER**. This PR does not grant that authority or deploy the parent early.

## Rollback

Before release, revert only this answer-fix commit. After release, restore the previous reviewed, schema-compatible web/worker version without reverting the authoritative lifecycle, receipts or database privileges. Unknown or overlong answers must never be reported as successful submissions.
