## Owner-approved read-only diagnosis complete — no repair applied

P6 remains FAIL / held for owner approval. No fourth lifecycle attempt, build, restart, VM configuration change or production/provider/DNS/IAM/network/secret change.

All three original errors remain unchanged:

1. `NativeMockCaseFailed_mock-health` — stage18, `docs/evidence/p6/owner-resume-lifecycle.json` (global read-only correctly prevented resume).
2. `NativeMockCaseFailed_schedule-mock_automation` — stage21, `docs/evidence/p6/owner-resume-lifecycle-pause-repair-one.json` (NULL singleton collision; expected queued=true, actual=false).
3. `NativeMockRestartHealthDeadline` — stage25, `docs/evidence/p6/owner-resume-lifecycle-schedule-repair-two.json` (localhost health timed out after explicit restart; previous-image rollback passed).

The candidate StartedAt is 26Oct08:16:55.805414197UTC, about155ms after the sealed restart-test intent. RestartCount=0, OOMKilled=false, current ExitCode=0 **after rollback's deliberate stop**; policy unless-stopped. The active rollback StartedAt08:18:54.797689225UTC is healthy and processing-paused (not Docker-paused), active0/mock/realAcceptancefalse.

Five retained in-container health probes passed after the restart, including within the90s host-health deadline. The failed localhost proxy pins172.18.0.17; current rollback proxy correctly targets172.18.0.16. Leading hypothesis: stale static proxy endpoint after Docker restart. Historical post-restart IP/event history is absent, so actual IP movement is **not claimed proven**. Proposed ONE fix only: fail-closed reconcile the same owned container/image's private IP and direct health, then narrowly retarget the existing loopback proxy and matching sandbox /32, verify direct/localhost SHA equality or roll back. NOT applied. Three offline mechanism/sandbox tests PASS.

Fresh diagnostic collection: 7/7 cases PASS; all34sealed mock app receipts,36jobs,4schedule receipts accounted for; exact before/after ledger hash2893901781b68b981837a78bb676161f18c954ba075b93dbb14737ddca8aafed. No retries/extra employer payloads; SMTP sink0, internal-only/provider-free workers. Full62orderedMD5/Auth27/2seq/3approved exceptions/552unchanged privileges+2approved queue roles/73Storage hashes PASS in both copies; FRESH112actual HBA checks PASS (8queue successes/104app rejects/no function calls). Raw inherited PUBLIC function finding remains recorded unchanged behind the approved connection boundary.

All477offline Oracle helper tests PASS. Caddy/gateway configurations match their sealed P5 baselines; protected jobs/auth routes match. Full app health remains truthfully503, Realtime/timer integration unfinished; no phaseP6/P7/P8/P9 PASS claim.

Write-once diagnostic manifestSHA256: `9641f3cb64dc1146b66b050f7c4e108e081f9cb2a7c3cd92f8d4004c0ef8f42e`. Both earlier collector-only tooling failures are preserved and chained; no native attempt-budget reset.

Operator-local detailed report: `docs/evidence/oracle-p6-readonly-diagnosis-20261026.md`; every retained row: `docs/evidence/oracle-p6-readonly-ledger-20261026.md`; sealed observations: `docs/evidence/p6/restart-diagnosis-20261026-03/`. They are committed locally, **not pushed**, because the PR workflows would build Docker images contrary to the no-build scope. This comment is a report only, not a build/review/repair trigger. PR remains draft/unmerged. STOP for owner decision; no cutover.
