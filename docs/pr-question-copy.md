# Ask for unstated job details without unknown placeholders

Stacked on the independently reviewed P0.4 answer patch (PR #19). Retarget to main after that parent merges, then require final-head CI before merging this copy-only follow-up.

## What and why

Phase 0's question template interpolated `job.remote_type` directly, producing “advertised unknown working pattern”. It also treated a general can-work-in-person preference as confirmation of that unknown role. Cover-letter copy incorrectly said the unknown arrangement was understood.

Use explicit human-readable remote/hybrid/on-site labels. Missing workplace, location, company and skill sentinel values are omitted or replaced by a confirmation question, not asserted as advertised facts. An unknown workplace remains empty/unreviewed even if a previous generic answer was remembered; an unnamed employer cannot inherit a previous-employer declaration. Known advertised facts retain their existing behaviour. Cover letters ask for missing IR35/workplace facts and use neutral missing title/company references. Existing saved packets are not rewritten automatically.

## Verification and screenshots

Focused unit regressions cover each known workplace, unknown placeholders, no inferred agreement, previous answer isolation and truthful cover-letter copy. Exact full-suite/CI outcomes belong in `docs/progress.md`. Copy-only change: no layout/screenshot baseline, accessibility exemption or added skip. No real employer or private customer data used.

## Migrations, environment, manual steps and rollback

None: no new dependency, variable, credential, migration or RLS/CSP change. After the authorized coordinated web release, prepare a draft with the named test account `anvesh.mannuru+ir35test@gmail.com` for an unstated-workplace fixture, inspect the unreviewed question and cover letter, and do not submit to an employer. The parent lifecycle still needs verified backup/migration compatibility; Git deployment remains held and no production runner cutover is authorized. Revert this isolated copy commit or restore the previous schema-compatible web deployment; never roll back receipts or weaken database guards for a wording issue.
