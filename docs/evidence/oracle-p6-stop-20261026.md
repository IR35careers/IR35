# Oracle staging P6 — third-failure stop, 26 October 2026

The owner authorised at most two self-heals and required a stop on the third failure of the resumed lifecycle gate. That limit is now reached. No fourth image, restart gate or repair has run. No phase completion is inferred from partial tests.

| Phase/gate | Actual result |
| --- | --- |
| P1–P4 | Existing completed evidence retained; no replay or source/cloud write. |
| P5 SDK guard | Existing actual401/401/200 proof and containment verified before P6. |
| First owner condition | PASS: Docker running since25Oct15:09:10UTC; processing flag paused, mock-only, unchanged12receipts/jobs, empty sink, no unexplained activity. Expected internal heartbeat traffic documented. |
| PID prerequisite audit | PASS: native pid,stat,comm; no Chromium/orphans, queue/sink/full containment. |
| HTTP status fix | PASS: invalid400/no writes; valid202/exactly-once publication, actual local HTTP+SQL tests and native rejection cases. |
| Startup pause self-heal1 | PASS: startup pause separate from global non-overridable read-only; native resume/maintenance cases. Original failed attempt retained. |
| Schedule self-heal2 | PASS: distinct validated operation singleton keys; all3native publications and durable operation rows. Original queuedfalse failure and existing-task drain retained. |
| Final lifecycle | **FAIL**:70recorded cases passed, then `NativeMockRestartHealthDeadline` after ONE Docker restart, unchanged90second deadline. |
| Automatic image rollback | PASS: previous691acf10/source1c07c85 image restored healthy and processing-paused/mock-only; failed a4dd534d candidate stopped and retained. |
| Snapshot containment after failure and rollback | PASS:62table counts+orderedMD5/Auth,2sequences,3approved extension-owner exceptions,552unchanged privilege checks+2approved queue roles,73Storage SHA256. |
| Post-restart durability/orphans/fresh final HBA read-back | NOT REACHED; not a PASS. Last pre-run current-file/native112-login-proof boundary passed unchanged. |
| Full P6 app/Realtime/timer integration | INCOMPLETE. Private worker lifecycle is not whole-application signoff. |
| P7, P8, P9 preparation/dry-run | NOT STARTED after this failed P6 gate. No final staging/cutover signoff. |

## Immutable evidence

- [Owner pause reconciliation](p6/pause-reconciliation-20261026-02/result.json): manifest5cc51791a86c13913296bd2707c54e279728822e67911b81bd6ff57d81f4d23a.
- [PID-corrected prerequisite audit](p6/status-resume-pid-audit-01/result.json): manifest7e08a4af09655a9be9efd249f5f0adcc1c4c8eb4691839a319d7470a241e1e4a.
- [First resumed failure/rollback](p6/owner-resume-lifecycle.json): stage18 d8fffe84db0bfd03f01505b568b83f2eda1a6bbc575dc230d3599b8c31577505; rollback19 cd09b85d58fadb696c1d6dbded69b2cac437c5d668a80c208b97a4df48b3fd16.
- [Second resumed failure/rollback](p6/owner-resume-lifecycle-pause-repair-one.json): stage21 d43b7b000ad706333857964ed86c60e428edcf7fcba8ea59c371676e15d97d70; rollback22 acb40dc6b3aba72106474d8c425fc854b3d7372e339c5f85f8b15e958d9e45fe.
- [Exact schedule diagnosis](p6/owner-resume-schedule-diagnosis.json) and [owned existing command drain](p6/owner-resume-schedule-drain.json): stage23 8987fe96307fa7d54380fbb8146483ca5438a89f937a10a77de53c937fc1f9ae. No deletion/reset/new application publication.
- [Final image proof](p6/worker-resume-build-3.json): manifestc2fed3bee63cc1239b2c92e4b72d8cdd1e7bdddad4fdd1046c01ca946c42d42f; immutable image `sha256:a4dd534d942dbbdf68f6c1d3f8ed7c760b8ccf409105a07e5d4dfc928c96dbc7`.
- [Final handover](p6/owner-resume-handover-schedule-repair-two.json): stage24 ed20f3042701057f7d0e7e8378135cbdde6c87156cb573e1fd4f4dfed61e12a9.
- [Third lifecycle failure and rollback](p6/owner-resume-lifecycle-schedule-repair-two.json): stage25 1ec2dfb4da03790cc4cb9d9e6db4bbd971ff61f3e81b24f53ea3c3a845c7f600; rollback26 e1885d6d47df03eebb26a8535791983ecb0b900eb7a3a1ff21d5c236dd13bfab. Explicit resumedLifecycleAttempt3/repairAttempt2 retained on failure.

## Source verification and safety

Strict TypeScript/lint,1078unit tests/161files,199legacy checks,463Linux helper tests, dependency audit and repository/history scans passed. Native ARM images were built on the existing A1, with pinned Playwright1.61.0/pg-boss12.38.0 and a real browser health check. No registry publication or paid builder was used.

No new OCI resources, IAM/network rules, production/Vercel/Supabase-cloud/Google/DNS changes, real email or employer submissions. Existing approved2OCPU/12GB/50GBboot+100GBblock allocation is unchanged. No fresh OCI billing/Object Storage inventory was performed during these SSH-only repairs; this is **not** a new claim of real-time zero billing or measured backup usage. All PRs remain draft and unmerged. Literal YES CUTOVER is absent.

## Next owner decision

Approve reopening read-only diagnosis of the restarted candidate's projected container state and private localhost proxy/address routing, plus the retained queue ledger. The restart-health timeout alone does not prove whether the cause is the worker, proxy addressing or another startup dependency. No root cause is asserted and no timeout/assertion, state/hash, catalogue or acceptance flag should be changed to make the gate pass. A further repair/run needs a new explicitly bounded owner decision after that evidence.
