# Auto-apply incident — 15 October 2026

Status: investigated in part; persistent-worker preparation is not a deployed incident resolution. Reported account: `anvesh.mannuru+ir35test@gmail.com`. Reported job: `7d8d7d76-72f9-4245-8112-b43a1ae5b797`, DevOps Engineer – GCP and AWS, Square One Resources, Adzuna.

## Confirmed observations

- The user saw a “submission started”/“Completing the employer form” modal, then Ready after reload with no useful error.
- Signed read-only production audit, 15 October 06:24 UTC: one matching job packet `ba6c2abb-5c75-4a93-a9f9-dbc70f8189ac`; packet `needs_review`; submission `processing`, error `needs_user`; worker task `c5f70534-b2aa-443e-9eaa-df3df8c4cf33`, `needs_user`, one attempt; action `employer_login`; all approvals true; no submission receipt/time. Destination remained `www.adzuna.co.uk`.
- Vercel historical logs correlate that application ID: 05:59:01 UTC `/api/applications/submit` authenticated, response 202; 05:59:04 UTC `/api/queues/applications` logged `cloud_application_processed`, state `needs_user`, duplicate false, response 200. These occurred on deployment `dpl_DkfGhfc9R3EwZw7ZS7mxX1AwdDHr`.
- The worker therefore **did run** and saved an attention outcome. For this recorded attempt, “no Chromium”, “runner never awaited” and a swallowed total worker crash are not supported root causes. An account/security boundary at the aggregator prevented confirmed employer submission. The report does not prove that a direct employer form existed or was resolved.
- The operational endpoint omits user identity. Matching job/application IDs are strong correlation but do not independently prove ownership by the named test email. Full auth-linked event/receipt/browser diagnostics need an authorized database/admin read. No real employer submission was retried to investigate.

## Code-level causes of misleading state

- Legacy packet `ready`/`needs_review` state, delivery `processing` state and worker `needs_user` state are persisted separately. `workspace/repository.ts` loads packet status directly and only exposes attention for `needs_review`; an approved or stale packet can consequently look Ready despite delivery failure/attention.
- `saveCloudWorkspace` upserts all local draft/ready/needs_review packets, including their status and approvals. Migration 017 permits pre-submission updates among those legacy states. A stale browser can regress a newer attention packet; the exact observed race still needs a recorded fixture/timeline, not assumption.
- `submission-status` also explicitly resets packets to ready while requeueing/recovering work. In-flight state is partly inferred from human-readable event labels (`application-submission-state.ts`) rather than one authoritative stored lifecycle.
- `application-runner/run.ts` tries discovery/direct-source resolution, then maps a 401/portal sign-in stop to employer_login. There is no authoritative external_only lifecycle yet for an unresolvable aggregator. A modal must not promise employer-form completion from approval/queue acceptance alone.

## Changes in this preparation

Railway/pg-boss handoff is feature-flagged and not deployed. The worker has standby readiness, 15s heartbeat, bounded queue retries, browser cancellation and a prepared ten-minute timeout watchdog. In Railway mode, old lease expiry alone cannot automatically rerun an unknown employer outcome. Vercel retains its current default; queue consumers are not removed before cutover. See `deploy-worker.md` for owner-run setup and rollback.

## Still required before calling this incident resolved

- Confirm test-account ownership and correlate full stored events/receipt with the UI repro.
- Implement the target authoritative forward-only state machine and atomic event writes, explicit Retry, Realtime UI, stale-save protection and external_only aggregator action.
- Mock ATS regressions covering approval -> queue -> submitting -> needs_info/submitted/failed/external_only across reloads, stale browser saves, callback loss, restart and watchdog timeout.
- Owner installs migration/queue, deploys Railway and verifies mock receipts before production flag cutover; no real employer CI submissions.

No claim is made that changing hosting alone fixes the legacy UI lifecycle or bypasses employer security controls.
