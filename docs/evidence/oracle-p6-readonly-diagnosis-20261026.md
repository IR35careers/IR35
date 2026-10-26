# P6 read-only diagnosis — 26 October 2026

READ-ONLY DIAGNOSIS PASS. P6 remains FAIL / owner-review hold; P7–P9 remain unstarted. This is not another lifecycle attempt or permission to repair it. PR #57 stays draft and unmerged.

Write-once observation: [result](p6/restart-diagnosis-20261026-03/result.json), [manifest](p6/restart-diagnosis-20261026-03/manifest.json), SHA256 `9641f3cb64dc1146b66b050f7c4e108e081f9cb2a7c3cd92f8d4004c0ef8f42e`. Seven of seven diagnostic cases PASS. No VM files/configuration changed, no builds, restarts, job publications, OCI/IAM/network/provider/production/DNS/secret changes. Existing SSH identity verified, no new unlock/login requested. Only operator-local diagnostic files, tests and documentation changed.

## 1. All three P6 failures (preserved)

| Run / gate | Exact error | What failed | Immutable artifact |
| --- | --- | --- | --- |
| Stage 18, resumed lifecycle #1, `mock-health` | `NativeMockCaseFailed_mock-health` | Harness started with global `IR35_READ_ONLY=true`, then expected an authenticated resume to override it. The runtime correctly refused. No new applications published. | [owner-resume-lifecycle.json](p6/owner-resume-lifecycle.json), manifest `d8fffe84db0bfd03f01505b568b83f2eda1a6bbc575dc230d3599b8c31577505` |
| Stage 21, resumed lifecycle #2, `schedule-mock_automation` | `NativeMockCaseFailed_schedule-mock_automation` | HTTP 202 was returned but `queued` was false, expected true. The preceding mock_ingest job occupied pg-boss's short-policy NULL singleton key. 55 earlier recorded checks passed. | [owner-resume-lifecycle-pause-repair-one.json](p6/owner-resume-lifecycle-pause-repair-one.json), manifest `d43b7b000ad706333857964ed86c60e428edcf7fcba8ea59c371676e15d97d70` |
| Stage 25, resumed lifecycle #3, restart-health | `NativeMockRestartHealthDeadline` | After one explicit Docker restart, localhost `/health` did not recover within the unchanged 90-second gate. 70 preceding checks passed. Failure-pause response was UNCONFIRMED; rollback then stopped the candidate. | [owner-resume-lifecycle-schedule-repair-two.json](p6/owner-resume-lifecycle-schedule-repair-two.json), manifest `1ec2dfb4da03790cc4cb9d9e6db4bbd971ff61f3e81b24f53ea3c3a845c7f600` |

Each has a separate successful previous-image rollback. Final stage 26 rollback manifest: `e1885d6d47df03eebb26a8535791983ecb0b900eb7a3a1ff21d5c236dd13bfab`. No original error, receipt, hash, assertion, timeout or counter was rewritten.

## 2. Restart and “paused” reconciliation

Fresh [Docker observations](p6/restart-diagnosis-20261026-03/02-worker-state-result.json), times UTC:

| Field | Failed candidate `ir35-p6-mock-worker-v6` | Current `ir35-p6-mock-worker-v6-rollback` |
| --- | --- | --- |
| Created | 2026-10-26 08:13:19.018191443 | 2026-10-26 08:18:54.714171561 |
| StartedAt | 2026-10-26 08:16:55.805414197 | 2026-10-26 08:18:54.797689225 |
| FinishedAt | 2026-10-26 08:18:53.849447838 | Not finished |
| Current state | exited / Running=false / DockerPaused=false | running / Running=true / DockerPaused=false |
| RestartCount | 0 | 0 |
| ExitCode | 0, **after deliberate rollback stop**, not the earlier restart exit | 0, while currently running |
| OOMKilled | false | false |
| Restart policy | unless-stopped | unless-stopped |
| Image digest | `sha256:a4dd534d942dbbdf68f6c1d3f8ed7c760b8ccf409105a07e5d4dfc928c96dbc7` | `sha256:691acf104f69f7cdf87dadf83370558886c8563fd9a22e1d8e99fb4c7e8f3e3f` |

The sealed stage25 `186-restart-intent.json` predates StartedAt by about 155ms: 08:16:55.650383 UTC. The committed lifecycle explicitly executes `docker restart --time 30` and records `workerRestarts=1`. Thus the restart was an intentional restart-test command, followed by a separate rollback deployment—not unexplained processing or evidence of an automatic crash-restart loop. Neither current OOM field nor policy count reports an OOM/policy restart. Historical Docker events are no longer retained, so they cannot independently exclude every past event: Docker returns only its last 256 events ([official limitation](https://docs.docker.com/reference/cli/docker/system/events/)).

The 25 October 22:36 report used **processing paused**, not Docker pause/stop. The earlier independent [pause reconciliation](p6/pause-reconciliation-20261026-02/01-processing-flag-result.json) proves the original v3 container retained StartedAt 25 October 15:09:10.813384336 UTC, RestartCount=0, `paused=true`, active=0. Its health, heartbeat and empty-queue watchdog were intentionally alive. Later authorised mock tests explain the additional records; it would be incorrect to say nothing has executed since 25 October.

Current rollback: `browserReady=true`, `databaseReady=true`, `paused=true`, active=0, realAcceptance=false, build `1c07c8507aa9049c6fe89c2f1c784fb2958084cf`. The failed candidate is stopped, not silently resumed.

## 3. Current routing versus expected

[Fresh route and systemd read-back](p6/restart-diagnosis-20261026-03/03-proxy-routing-result.json): every configuration hash matches its sealed owner-approved baseline. Four HTTP probes match their expected branches and status; request IDs are preserved in that JSON.

| Staging route | Current upstream / result | Expected / diagnosis |
| --- | --- | --- |
| Host localhost `127.0.0.1:8787/health` | Existing final-rollback2 socket/service -> `172.18.0.16:8787`; HTTP 200, correct rollback SHA, healthy/paused/mock | MATCH; direct private-IP health agrees. No external 8787 listener. |
| Retained failed final-repair2 proxy | Configured `172.18.0.17:8787`; both units inactive | Expected after rollback; sealed files unchanged. Historical post-restart candidate IP was not captured. |
| `staging.ir35careers.com/*` outside `/supabase/*` | Basic-auth page branch -> `ir35-p5-web:3000` | MATCH; `/jobs`=200. |
| `staging.ir35careers.com/api/health` | Same app upstream, HTTP 503 | MATCH with truthful P5 baseline, **not full P6 readiness**. Worker/Realtime/timer integration remains incomplete. |
| `staging.ir35careers.com/supabase/{auth,rest,storage,realtime}/v1/*` | Exact-cookie SDK guard, remove `/supabase`, then `ir35-p5-kong:8000` | MATCH; authenticated auth health=200. Unsupported SDK paths use 404 fallback; no auth weakening. |
| `api-staging.ir35careers.com/{auth,rest,storage,realtime}/v1/*` | Protected API branch -> `ir35-p5-kong:8000` | MATCH; protected auth health=200. Unsupported API paths use 404 fallback. |
| Kong `/auth/v1/` | `http://ir35-p5-auth:9999/` | MATCH |
| Kong `/auth/v1/verify`, `/callback`, `/authorize` | Same Auth container, corresponding exact suffix | MATCH |
| Kong `/auth/v1/.well-known/jwks.json` | `http://ir35-p5-auth:9999/.well-known/jwks.json` | MATCH, original P5 route, not a new exception |
| Kong `/rest/v1/` | `http://ir35-p5-rest:3000/` | MATCH |
| Kong `/storage/v1/` | `http://ir35-p5-storage:5000/` | MATCH |
| Kong `/realtime/v1/` | No P5 gateway service yet | Known incomplete P6 integration, not a newly claimed PASS. |

All seven gateway service URLs and the whole file hash match sealed P5 prepare: `2dcdd388cee9887bff8952702276d986e3cb43592ae00851ca9a654a5128e1d8`. Caddy hash remains `2a4fad8dd6c35c3708c1d5a382f88dd105475cf54dc5d10425771da19758a49a`. Existing Basic auth/noindex/no-store/cookie configuration was not changed.

## 4. Every retained row and no-real-processing evidence

[Complete human-readable ledger, every ID/status/creation field/attempt](oracle-p6-readonly-ledger-20261026.md), plus the [sealed JSON](p6/restart-diagnosis-20261026-03/04-queue-ledger-result.json).

- 34 authorised mock application receipts: 10 submitted, 24 intentionally failed. All terminal receipts exactly match sealed native evidence, including the original 12. Two watchdog fixtures intentionally have no application queue job.
- 36 retained pg-boss jobs: 32 application jobs and four schedule jobs. States: 14 completed, 18 failed, four cancelled. Every payload equals its sealed owned mock intent; no employer URL fields, non-test actors, extra jobs or retries.
- Four durable schedule receipts, each linked to one of those four jobs. One heartbeat row, active=0, expected rollback build.
- `created_at` does not exist on mock application/schedule-receipt tables. It is shown as **not stored**, with requested_at/updated_at/completed_at separately. No creation timestamp or attempt count was invented.
- Latest application update: 26 October 08:16:52.516423 UTC; latest job completion: 08:16:55.550718 UTC, before the explicit restart. Before/after diagnostic stable ledger SHA256 is identical: `2893901781b68b981837a78bb676161f18c954ba075b93dbb14737ddca8aafed`. Heartbeat is excluded because its expected 15-second internal writes continue.

[External-isolation evidence](p6/restart-diagnosis-20261026-03/05-external-isolation-result.json): APPLY_RUNNER=mock, APPLICATION_WORKER_ACCEPT_JOBS=false; both retained worker images are provider-free, unprivileged/read-only, only on the existing internal Docker network, with no proxy, host networking or Docker socket. Owned immutable mock programs use the loopback mock ATS. Both Auth stacks route to the same unpublished SMTP sink on 1025, no credentials/relay/forwarding. Sink has **zero messages**, zero restarts and StartedAt 20 October 21:06:05.524915751 UTC.

No real-employer application or real email is evidenced or authorised. Mock-only sealed payloads/programs and network/provider isolation support that conclusion; there is **no retrospective packet capture**, so this report does not invent a packet-by-packet historical proof. Expected database heartbeat/watchdog and these read-only probes are not called “zero traffic.”

## 5. Fresh full containment

[Full report](p6/restart-diagnosis-20261026-03/06-full-containment-result.json), both pristine rehearsal and P5 fixture:

| Gate | Result |
| --- | --- |
| 62 table exact counts and ordered MD5, each database | PASS; no data differences |
| Auth parity / 27 Auth-table checks; password bytes covered by whole-table fingerprints | PASS |
| Two sequence states, each database | PASS |
| Schema / roles / extensions | PASS; only the same three approved extension-owner exceptions; two approved P6 queue-role additions reported separately |
| Original 552 app-role privilege checks | PASS, unchanged |
| 73 Storage objects, SHA256 per object | PASS |
| Sealed P4/native manifests, protected fixture and original Caddy | PASS, unchanged |
| pg_hba exact hash/order/inventory and retained raw function finding | PASS; current hash `443eb1cee65e0cec7f947026c892426c6bd979a5a85678a75ba3a9d9e4724c68` |
| Fresh actual login checks, two roles x 14 connectable DBs x four transports | PASS: 112 checks, eight queue successes, 104 explicit app/clone HBA rejections, zero function calls |

The inherited PUBLIC `add_to_waitlist` ACL remains `REVIEW_REQUIRED` in raw metadata, unchanged and never filtered from the baseline. The separately approved connection boundary denies both queue roles every app/clone login; the operational queue database has no outside-queue function access. No grants, policies, roles, HBA file, secrets or customer data were repaired/reloaded by this diagnosis.

## 6. One proposed fix — NOT APPLIED

Confirmed failure location: **host-side restart health path**, not demonstrated worker failure. The stopped candidate retains five successful **in-container** HTTP health probes at 08:17:46, 08:18:01, 08:18:16, 08:18:31 and 08:18:46 UTC, each exit 0. Several are inside the 90-second localhost failure window. Thus its browser/DB readiness recovered, but the gate through localhost did not. The current `unhealthy` label on the stopped container must not override those timestamped successful probes.

Likely mechanism: the systemd proxy pins a dynamically assigned Docker IP (`172.18.0.17`) and the lifecycle restarts the container without reconciling that endpoint. Docker can reassign a dynamic address. **The historical post-restart IP was not recorded, so actual IP movement is a hypothesis, not a proven observation.** The missing event history and suppressed proxy stderr prevent stronger retrospective attribution.

Propose ONE bounded, fail-closed repair: after the already-required restart, reconcile the **same owned container/image** against its current IP on the existing internal network; verify direct health/SHA/mock/non-acceptance first, then render and reconcile only the existing localhost proxy's target and matching sandbox `/32` using the existing unit factory. Require localhost and direct health/SHA equality before proceeding, or restore the previous unit/image and stop. No new network, public port, sidecar, secret or relaxed health deadline. A changed proxy configuration or new native lifecycle run still requires a new explicit owner approval.

Offline-only proposal tests: [test_p6_restart_proxy_proposal.py](../../infra/oracle/tests/test_p6_restart_proxy_proposal.py). Three PASS: a loopback-only endpoint change reproduces old-target failure while the new worker endpoint is healthy; the existing unit factory retargets only the IP and preserves listener/sandbox; public/link-local destinations are refused. This proves the failure mechanism and narrow rendering properties, **not that the historical IP changed or that an unapplied runtime repair passed**. No runtime repair code was applied.

All 477 Oracle helper tests PASS in 20.513s, including 11 collector regressions and the three proposal tests. Their OCI-looking fixture output is mocked/offline, not an actual resource create.

## 7. Collector incident chain and stop

- Collection01 manifest `941cec46766f225482fc126802fb2241c71e14e77ffb7851189b18aa72a0f284`: new diagnostic module bundle missed an existing logging dependency; no case observation/VM write. Preserved.
- Collection02 manifest `47f2e1872fea3fadd48d3a6fb0808eb5b27a9cfb70d70791049bfde40c2e5a06`: new diagnostic URL whitelist excluded dots in the ORIGINAL JWKS path. Independent [gateway-byte check](p6/restart-diagnosis-gateway-byte-check-20261026.json) proves unchanged sealed bytes. Preserved.
- Final collection03 PASS after the two bounded diagnostic-tool repairs, chaining both original manifests. No lifecycle-budget reset, no fourth build or native lifecycle attempt.

No code push was made: PR workflows would automatically build Docker images, contrary to the explicit no-build instruction. Diagnostic code/tests/evidence are committed locally; PR #57 remains at its previous remote revision. No production/provider/OCI cost claim is inferred from this SSH-only audit; no resources were changed and billing was not freshly queried.

STOP for owner review of the proposed proxy repair. No fix, build, restart, P6 retry, P7/P8/P9 advancement or cutover is authorised by this report. Literal YES CUTOVER remains absent.
