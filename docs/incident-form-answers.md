# Phase 0 form answers — independent evidence and safe lengths

Baseline inspected at `133e37c` (the CV follow-up head). The original private CV and employer form are unavailable; these findings reproduce the reported mechanism with synthetic evidence, not a claim of a live employer submission.

## Confirmed paths

- `src/lib/workspace/engine.ts`, `buildScreeningQuestions`: each skill question used the first matching **whole CV line**, after slicing each line at 800 characters. AWS and Azure on that line therefore got the same text; the slice could end in `Azure (AKS,`. Evidence occurring later on a long line was lost before matching.
- `src/lib/application-runner/field-mapping.ts`, `screeningAnswer`: a substring fallback could borrow an answer from a different or generic question. Conflicting reviewed duplicates were resolved by first match rather than requiring confirmation. Question normalization also collapsed C, C# and C++.
- `src/lib/application-runner/run.ts`, `snapshotFields` / `fillField`: a fieldset legend took precedence over the distinct labels of text controls, collapsing unrelated questions in the same group. No maxlength was captured or enforced before typing/filling; native input behaviour could clip the answer mid-word.

## Patch

Select an evidenced sentence independently for each skill, preserving its wording and requiring the requested term and delivery/experience context. A bare shared skills list is not a narrative answer. Do not truncate before selecting evidence. An absent or unfit answer stays empty/unreviewed; these conservative deterministic rules may ask for review of other valid wording rather than inventing it.

Use one normalized question identity for saved answers and employer lookup, preserving C/C#/C++/.NET distinctions. Accept only a unique reviewed answer to that exact question, not a generic substring. Radio/checkbox groups retain their legend semantics; text controls use their own labels first.

Capture employer maxlength. Whole answers that fit are unchanged; overlength narrative answers may use only a prefix of complete, balanced sentences. If no full sentence fits, leave the field unresolved instead of inventing, clipping or substituting another answer. Identity/contact/numeric facts must fit unchanged. Required unresolved fields continue through the existing needs-user result, with no submission.

## Verification and limits

Unit regressions cover AWS/Azure sentences on the same CV line, evidence beyond the old 800-character cut, unknown skills, the exact incomplete-parenthesis case, invalid/zero limits, full unpunctuated short answers, question conflicts, generic substring rejection and C-family saved-answer isolation.

The real Chromium mock-ATS regression intercepts every browser request: a single fieldset has separate AWS/Azure labels and maxlength controls. The fitting case must submit the distinct complete answers exactly once; the too-short Azure case must preserve AWS, leave Azure empty, return its exact review question and submit nothing. It runs in all three configured projects, without new skips. No customer CV, production database, real employer or paid AI request is involved. Exact results are recorded in `progress.md` after completion.

This fixes deterministic preparation/mapping/length handling, not the full Phase 4 structured-AI question service. Unknown questions still require confirmation; no new model is allowed to fabricate experience. Existing saved packets are not rewritten automatically. No migration, environment change, RLS/CSP change or production cutover is part of this patch.
