# Preserve draft edits through save acknowledgements and application tabs

## What and why

Apply editor actions to the current workspace record rather than a component's pre-acknowledgement snapshot. Otherwise the intentional stale-version guard discards the keystroke as well as the stale metadata. Compute CV blur normalization/scoring against the latest text. See `docs/incident-draft-edits.md` for the reproducible mechanism and evidence limits.

Keep server-owned lifecycle/version/receipt/failure fields and application identity immutable to editor callbacks. Reject edits after queue/submission or completed recruiting stages, and reject absent records. Preserve existing CV identity cleanup, database CAS, RLS and the external store's stale-state guard. No new authenticated browser persistence or permission relaxation.

## Tests and screenshots

Exact results belong in `docs/progress.md`. Vitest uses the actual store to reproduce the ACK/stale-ref race and checks rapid edits, read-only states, missing records and protected metadata. Real browser cases visit all four tabs, preserve two answers plus CV/letter edits, reload the labelled preview and assert zero submission requests across all three projects. Preview reload is not claimed as live Supabase Realtime verification. Copy/layout is unchanged; no screenshot baseline, accessibility assertion or platform skip is loosened.

## Migration, environment and manual verification

None for this patch: no dependency, variable, secret, migration, provider/DNS configuration or RLS/CSP change. The parent lifecycle still requires a verified encrypted backup and compatible migration/web release; Git deployments remain held and no worker cutover is authorized. After release, use `anvesh.mannuru+ir35test@gmail.com` to edit a draft while a save acknowledgement arrives, switch Form/CV/Cover letter/Contract and reload after cloud acknowledgement. Verify stored answers without submitting to an employer. Cross-device CAS conflicts must still be surfaced instead of silently overwriting another revision.

## Rollback

Revert only this editor/store follow-up before release, or restore a reviewed schema-compatible web deployment afterwards. Never relax database grants, regress delivery state or erase confirmed receipts to repair an editor issue.
