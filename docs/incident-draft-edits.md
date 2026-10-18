# Phase 0 — application answers and tab persistence

Baseline: `cef533d`. The original customer's session/trace is unavailable. This is a reproducible current-code race, not an invented production timing trace.

## Confirmed mechanism

`ApplicationStudio.updateApplication` built an entire next packet from `applicationRef.current`. The ref caught up with React state in an effect. Meanwhile, `workspace/store.ts` could receive a save acknowledgement with a higher `deliveryVersion`, update the external store and notify React. A keystroke in that interval still carried the component's older version. `updateWorkspace` correctly rejected the stale snapshot to protect server-owned lifecycle progress, but the keystroke was discarded along with it. Changing tabs or receiving another render could reveal the older answer again.

`recalculateEditedCv` also captured component-local CV text before entering its update callback. A blur while moving between material tabs could therefore reapply older text instead of scoring the latest stored edit.

## Patch and invariants

Apply editor actions inside the external store's functional update, reading the current application by ID. Keep the ref and component state aligned with that exact edited record. CV blur reads the current material inside the action too. Preserve the existing identity/signature cleanup when adopting the latest record.

The shared editor helper retains authoritative version/state, failure details, application/job identity and existing receipt provenance. It never invokes an edit for queued/submitting/submitted/skipped records or completed recruiting stages, and never recreates a record removed from the current workspace. A no-op does not schedule a cloud save. The stale-version store guard, database compare-and-swap, RLS and receipt protections are unchanged; this is not permission for last-writer-wins overwrites across devices.

## Verification scope

Vitest exercises the real workspace store: a version-2 acknowledgement arrives while the simulated component still holds version 1; the old snapshot is rejected and loses its keystroke, while the fixed current-store action retains the new answer and newer material/version. Other regressions cover rapid composed edits, locked states, absent records and attempted metadata/receipt replacement.

Playwright edits two answers, visits Form/CV/Cover letter/Contract, edits CV and cover-letter text, and reloads the labelled local preview. Each material must remain saved and no submission request may occur. It runs in all three configured projects with no new skip. Preview reload proves the local preview path; it does **not** prove hosted Supabase Realtime. Existing migration-025 SQL/CAS tests and final CI remain required, followed by authenticated production verification after the coordinated release. No private customer CV or real employer is used.

There is no new browser storage for authenticated CVs, no schema/environment change and no provider action in this patch. Existing unsaved-network/conflict error reporting remains; a hard reload before cloud acknowledgement is not newly represented as a guaranteed offline save. Exact test/CI results are recorded in `progress.md`. P0.6 remains open until the production fix is released and verified.
