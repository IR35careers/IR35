# P8 snapshot application capabilities — read-only inventory PASS, application compatibility BLOCKED

Source commit `66b102fdf1e936de95de152819898aa0cbd8fc6a`. New slot `snapshot-app-readiness-01` is USED; do not replay it. [Sealed manifest](p8/snapshot-app-readiness-01/manifest.json) SHA256 `3795578c54b5710510b56b6c4edb9533051a41a342b95864f47715d205531b37`. [Actual inventory and full containment](p8/snapshot-app-readiness-01/01-snapshot-capabilities-containment-result.json).

No OCI request, VM/config/container write, migration, source-cloud request, customer write, secret-value change or production/provider/DNS/IAM action. The existing SSH identity was independently loaded by fingerprint; no prompt or new login was needed. The query reads fixed PostgreSQL catalogue names/types in a read-only transaction, not customer rows or function definitions. Full containment subsequently reads and verifies the unchanged protected copies.

## Actual compatibility finding

The verified source snapshot lacks ALL ten columns and ten functions added by `025_application_delivery_lifecycle.sql`:

| Relation | Missing columns |
| --- | --- |
| application_packets | delivery_status, delivery_version, failure_reason, error_detail, delivery_started_at |
| application_events | from_status, to_status, failure_reason, error_detail |
| application_worker_tasks | attempt_base |

Missing functions: application_has_delivery_receipt, application_delivery_can_transition, guard_application_delivery, audit_application_delivery, transition_application_delivery, commit_application_delivery_result, project_application_task_delivery, guard_application_task_attempt, claim_application_delivery_task, save_application_draft.

This is an authenticated observation of the preserved snapshot, NOT an assumption from migration filenames or a new source/target mismatch. Architecture already records025 as uninstalled. Current web source's repository/save/submission paths require these fields and functions; P6's isolated mock queue tests and P8's anonymous read browser tests do not exercise those normal paths. Do not label save/mock-apply frontend QA PASS on the preserved baseline, change the current pristine/P5 fixtures, run025 against cloud, bypass validation, turn on real acceptance or silently fall back to Ready.

Pending upgrades were owner-approved only on a SEPARATE disposable copy, with before/after schema and data changes recorded. That remains necessary before a writable browser fixture: prove pristine-clone equality first, apply/review the upgrade only there, distinguish deliberate upgrade deltas from migration fidelity, and verify the original pristine/P5 copies unchanged afterward. Presence of all capabilities would still be PRESENT_ONLY, not proof of permissions, function semantics, Auth/session/RLS or complete browser QA. No upgrade/clone write occurred in this inventory.

## Full containment after the inventory

- Both protected copies:62table counts/orderedMD5, Auth/hash parity,2sequences and original manifest custody PASS.
- Only3approved extension-owner exceptions;552original app-role checks unchanged plus2approved queue identities; source roles unchanged.
-73Storage objects/byteSHA256 each PASS, original Caddy files unchanged.
-112fresh actual HBA logins PASS:8queue positives,104application rejects,0function calls. No new container/reload/restart.
- Source/pristine/P5 writes0; no customer-data repair or comparison waiver.

The new helper passed616tests in fresh HOME/no.ir35/no private files/no real keys/no VMcalls,46.377s; [manifest](p8-app-readiness-hermetic-02/manifest.json) `7b223610dd72b4052330b0de65ef7d6624e31d92df4cc21832946e493d45f61f`. Earlier615PASS retained. Static review before any VM call tightened catalogue filtering to exact table/column pairs; a regression prevents the broader cross-product from falsely including existing worker columns. Historical hashes/assertions/timeouts and native slots remain unchanged.

P8 remains INCOMPLETE. Actual encrypted backup/restore and a supported exact managed-Storage reverse path, writable frontend QA, monitoring and timed drills remain required. Existing backup key-custody/narrow-IAM owner batch is unchanged; no new owner credential request. P9 is NO-GO/preparation only; exact YES CUTOVER is absent.
