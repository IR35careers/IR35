# Auto-apply incident — 15 October 2026

Status: test-account attribution and persisted timeline verified through the authenticated Supabase CLI; lifecycle fix under verification, **not deployed**. Reported account: `anvesh.mannuru+ir35test@gmail.com`. Reported job: `7d8d7d76-72f9-4245-8112-b43a1ae5b797`, DevOps Engineer – GCP and AWS, Square One Resources, Adzuna.

## Root cause of Ready after reload

The in-flight indicator depended on a **browser-only event that was never saved**. At baseline commit `5a34659`, `src/components/workspace/ApplicationStudio.tsx:999` constructs a local `submissionStarted` copy and appends `Application submission started` at line 1011; line 1018 sends it to the local workspace store. But `src/lib/workspace/repository.ts:502` persists only created/prepared/approved/note events, excluding that status_changed event. On reload, line 194 loads the legacy packet status directly. `src/lib/application-submission-state.ts:51` treats a ready packet as in-flight **only** if the missing started label exists. Consequently, a queued/running application reloads as Ready until the worker saves another packet state. This does not require a speculative stale-save race.

The delivery was not successful: it ended at an Adzuna account boundary. The old schema records this as packet needs_review + submission processing/error needs_user + task needs_user, rather than submitted or failed. That explains the absent submitted/failed event; it does not justify displaying Ready or promising automatic employer submission.

There are additional regression risks: stale packet upserts (`workspace/repository.ts:494`), approved snapshot writes without a lifecycle/version check (`api/applications/submit/route.ts:91` and 114), and the error path explicitly writing ready (`submit/route.ts:897`). These are real code defects, but no historical per-write audit exists to prove which stale writer ran in this incident. The primary reload defect above is independently demonstrated by the code, the absent started event and the stored-state regression fixture.

## CLI database evidence (read-only, 15 October)

Executed successfully after native Supabase browser login:

```powershell
npx supabase db query --linked --project-ref kxcbgflleqnjzjbkevwd --file supabase/verification/025_incident_readonly.sql --output-format json
```

The query uses `BEGIN READ ONLY`/`ROLLBACK`, joins the packet to its auth owner, and prints only a test-account match boolean, status/timestamps and routing host. No CV, answers, email address, token or secret is returned. It confirmed **is_requested_test_account=true**.

| BST, 15 October 2026 | Stored evidence |
| --- | --- |
| 06:54:13.580 | Materials prepared event |
| 06:59:02.804 | Application approved event |
| 06:59:03.870 | Submission row created |
| 06:59:04.018 | Durable task created |
| 07:02:41.937 | Task completed, needs_user, attempt 1, destination www.adzuna.co.uk |
| 07:02:43.286 | Packet needs_review; submission processing/error needs_user/action employer_login |
| 07:02:43.384 | Employer sign-in is required event |

There is no stored started event, no submitted_at and no confirmation receipt. BST is UTC+1; database timestamps are UTC. The earlier Vercel 05:59:04 UTC request timestamp is the **start of the queue invocation**, not proof that the employer outcome arrived three seconds after approval.

Vercel CLI was also run with `logs dpl_DkfGhfc9R3EwZw7ZS7mxX1AwdDHr --no-follow --no-branch --since 2026-10-15T05:58:45Z --until 2026-10-15T05:59:30Z --query ba6c2abb-5c75-4a93-a9f9-dbc70f8189ac --json --limit 20` (HTTP 400). A subsequent production-wide `--since 4h` query exited successfully with **zero retained entries**. Do not misrepresent this later check as fresh log evidence. Earlier captured Vercel records remain below; the live CLI database timeline independently confirms queue execution and outcome.

## Confirmed observations

- The user saw a “submission started”/“Completing the employer form” modal, then Ready after reload with no useful error.
- Signed read-only production audit, 15 October 06:24 UTC: one matching job packet `ba6c2abb-5c75-4a93-a9f9-dbc70f8189ac`; packet `needs_review`; submission `processing`, error `needs_user`; worker task `c5f70534-b2aa-443e-9eaa-df3df8c4cf33`, `needs_user`, one attempt; action `employer_login`; all approvals true; no submission receipt/time. Destination remained `www.adzuna.co.uk`.
- Vercel historical logs correlate that application ID: 05:59:01 UTC `/api/applications/submit` authenticated, response 202; 05:59:04 UTC `/api/queues/applications` logged `cloud_application_processed`, state `needs_user`, duplicate false, response 200. These occurred on deployment `dpl_DkfGhfc9R3EwZw7ZS7mxX1AwdDHr`.
- The worker therefore **did run** and saved an attention outcome. For this recorded attempt, “no Chromium”, “runner never awaited” and a swallowed total worker crash are not supported root causes. An account/security boundary at the aggregator prevented confirmed employer submission. The report does not prove that a direct employer form existed or was resolved.
- The original operational endpoint omitted user identity. That attribution gap has now been closed by the authenticated CLI query above. No real employer submission was retried to investigate.

## Code-level causes of misleading state

- Legacy packet `ready`/`needs_review` state, delivery `processing` state and worker `needs_user` state are persisted separately. `workspace/repository.ts` loads packet status directly and only exposes attention for `needs_review`; an approved or stale packet can consequently look Ready despite delivery failure/attention.
- `saveCloudWorkspace` upserts all local draft/ready/needs_review packets, including their status and approvals. Migration 017 permits pre-submission updates among those legacy states. A stale browser can regress a newer attention packet; the exact observed race still needs a recorded fixture/timeline, not assumption.
- `submission-status` also explicitly resets packets to ready while requeueing/recovering work. In-flight state is partly inferred from human-readable event labels (`application-submission-state.ts`) rather than one authoritative stored lifecycle.
- `application-runner/run.ts` tries discovery/direct-source resolution, then maps a 401/portal sign-in stop to employer_login. There is no authoritative external_only lifecycle yet for an unresolvable aggregator. A modal must not promise employer-form completion from approval/queue acceptance alone.

## Changes in this preparation

Railway/pg-boss handoff is feature-flagged and not deployed. Migration 025 adds server-owned delivery_status/version/reasons without deleting CVs, receipts or recruiting history. Database guards reject backwards transitions except explicit Retry; result, transport projections and event commit atomically. Browser writes use owner-checked version CAS, not status upserts. Claims do not reclaim unknown running outcomes; absolute attempt IDs survive Retry, and transient retries are capped at two. The modal/page/tracker consume stored delivery state and owner-RLS Realtime; status GET is read-only. Unresolved aggregators produce external_only. Regression tests use real local PostgreSQL execution and controlled/mock destinations, never employers. None of this is declared production-verified before migration, CI, staging and approved cutover.

## Still required before calling this incident resolved

- Finish live UI/mock reload verification and CI for the implemented lifecycle/Realtime/CAS/external-only changes.
- Mock ATS regressions covering approval -> queue -> submitting -> needs_info/submitted/failed/external_only across reloads, stale browser saves, callback loss, restart and watchdog timeout.
- Agent runs installation, migration/queue and standby deployment under the owner's new end-to-end authorization. Explicit YES CUTOVER is still required before production flags; no real employer tests.

No claim is made that changing hosting alone fixes the legacy UI lifecycle or bypasses employer security controls.
