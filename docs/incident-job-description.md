# Phase 0: descriptions, excerpts and mobile expansion

## Evidence at the pre-fix source (4c381b3)

- `src/lib/job-preview.ts:93` strips the external source HTML then calls `.slice(0, 100_000)`. The resource limit is useful, but a description crossing it can end mid-word with no limited-import marker. Meta description fallbacks are not distinguished from a structured advert.
- `src/components/workspace/ApplicationStudio.tsx:1732` says **Full contract description / shown in full** even when the source text ends in an ellipsis. The public job page has a summary warning, but the saved application Contract tab does not.
- `src/app/analyse-job/page.tsx:57` uses `max-h-60 overflow-y-auto`; `src/components/resume/ResumeRefiner.tsx:103` uses `max-h-80 overflow-y-auto`. These nested text scrollboxes are hard to expand/review on a phone. Public/application record text lacks consistent long-token wrapping.
- A real synthetic 100,000-character source import test exposed an additional parsing cost: `findRateInText`'s unanchored greedy sentence prefix retries from every position when the paragraph has no pay period. That case took about ten seconds and exceeded Vitest's unchanged five-second limit. This is a measured local reproduction, not a claim about every slow production request.

## Fix

- Shared `JobDescriptionText` renders all supplied text as escaped React text, preserves paragraphs and wraps unbroken tokens with `overflow-wrap:anywhere`. No clamping or fixed-height internal scroll. Native disclosure remains keyboard/touch usable without JavaScript. Application preparation retains its separate Open role details action.
- Reuse across the public job, preparation, saved application's Contract tab, external analyser and CV review. Display source-summary/missing/limited-import notices and a protocol/credential-checked original link where available. Do not claim a full advert has been recovered merely because a snippet has no ellipsis.
- Keep the 100,000-character import cap; when exceeded, retain complete words with an ellipsis, never a partial token/surrogate. A too-long unbroken first token yields an honest limited-import notice rather than fabricated content.
- Optional in-memory `description_kind` distinguishes known meta fallback/limit/missing states. Missing-source UI text no longer becomes job evidence. No database column or migration. Ordinary stored jobs remain conservative: trailing ellipsis is a summary signal, absence is not completeness certification. Known excerpts/limited imports are withheld from JobPosting markup.
- Anchor rate extraction at sentence boundaries without changing its currency/pay-period evidence requirement. Preserve decimal hourly and multi-line daily-rate regressions. The original oversized-input test now passes; no timeout was increased.

## Verification and boundaries

Initial focused **57 unit checks pass** across description, preview and SEO suites; strict typecheck passes. Full release checks pass **810 unit tests/131 files + all 199 legacy checks**, TypeScript and ESLint before the final native-disclosure footer/browser additions. An isolated production build and 12 phone/tablet/desktop browser cases are running: long tail + no overflow, native touch/keyboard, excerpt/missing/limited notices, escaped content, source link, public/application tabs/reload, and pre-preparation disclosure. Accessibility checks cover the new content. No real employer submissions or credentials.

The first isolated production build and **all 12 browser cases passed together**, with no new skips, assertion exemptions or baseline/tolerance changes. Native touch/Enter/Space, original and role-details links, source end markers after tabs/reload, exact no-horizontal-overflow and scoped serious/critical accessibility all pass. Successful image attachments were not persisted by the list reporter, so the capture now writes to `testInfo.outputPath` before attaching it; a fresh capture/verification pass and final source checks are required rather than inventing a reviewed screenshot.

The fresh capture run also passes **all 12 cases** with a new production build. Actual fictional phone and desktop images were inspected and retained as `docs/screenshots/p0-10/description-mobile.png` and `description-desktop.png`. Final full local verification passes **810 unit tests/131 files, all 199 legacy checks, TypeScript and ESLint**. Source/history and dependency audits pass with only the two pre-existing exact owner exceptions until 29 October. Final-head CI remains the next code delivery gate, not a claim of production connectivity.

Final-head source/CI and compatible production release remain required. This does not invent missing provider text or acquire a licence to scrape Indeed/LinkedIn. Existing bounded official Reed detail recovery is preserved. Full source ingestion/JobPosting coverage remains S3/I2 work. No migration, RLS/CSP change, hosted auth, paid service or runner flag mutation. Migration 025/web coordination and Oracle account/standby/cutover gates are unchanged; P0.10 is not marked production-complete from local tests.
