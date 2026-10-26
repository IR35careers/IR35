# Decoder repair / isolated dispatch — STOP

26 October 2026. **The isolated gate failed on observability. No full P6 run was started. No retry, drain, republish or further live repair followed.** The original hard-paused rollback was restored successfully.

## Completed repair and offline tests

The dispatcher strictly decodes one surrounding matching single/double quote pair, accepts unquoted64hex, trims external horizontal whitespace only, and rejects malformed/unmatched/nested quotes, embedded newlines/NUL, invalid hex, duplicate/malformed env keys and invalid file custody. It never prints env values.

New diagnostics expose fixed error codes plus redacted length/SHA256-prefix fingerprints, never raw vendor error text or credentials. The systemd collector writes a sanitised result **before** failing a gate; it starts a service exactly once. Unknown journal messages are retained only as length/hash-prefix redactions. Unit stderr goes to journald and is copied only through this redactor into sealed evidence.

All **501 Oracle helper tests PASS**,29.633seconds. Coverage includes single/double/unquoted/whitespace formats, the original66character regression, malformed values, unchanged HTTP202/HMAC/body contract, actual dummy-only loopback HTTP dispatch for all three valid formats, secret-bearing error redaction, and restore/hash checks. No assertion/hash/catalogue/timeout was relaxed. These tests did not simulate systemd discarding post-exit invocation metadata; the native gate exposed that coverage gap.

## Native isolated result

[Full isolated result](p6/decoder-owner2-isolated/01-isolated-dispatch-result.json), native stage33 manifest `028b5e3ac651d22a015e50e6ef53a25172fec367d23ece3f0fbbc59a39c1c76b`; [local manifest](p6/decoder-owner2-isolated/manifest.json) `6f963b27d9dc2326b5de63645f8645cdbed53fa3debe7f39cbaef615ec5739ef`.

| Check | Result |
| --- | --- |
| Preflight45receipts/49jobs/7schedule receipts / SMTP/private rollback identity | PASS |
| Approved temporary same rollback image at private.241 | Started, processing initially paused; only private mock processing enabled for the approved probe |
| ONE new fixed-dispatcher systemctl start | Exit0, Result=success, ExecMainStatus=0 |
| Accepted mock schedule | Exactly one new owned watchdog queue row observed |
| Sanitised command stderr | Length0, SHA prefix `e3b0c44298fc`; no raw values |
| Journal-capture proof | **FAIL**: completed one-shot's InvocationID unavailable; journal read was therefore not attempted |
| Overall isolated gate | **FAIL**, `DecoderMockSystemctlDispatchFailed_SeeSealedRedactedStderr` |
| Full P6 run | **NOT STARTED**, prerequisite did not pass |

The dispatcher successfully passed its quoted-value validation and submitted the matching mock command. The failure is the collector's dependency on a late `InvocationID`: its PASS condition also requires `journalReadExitCode=0`, and that field is absent when no valid invocation ID remains. Read-only systemd projection after exit confirms inactive/dead, Result=success, ExecMainStatus=0, **InvocationID empty**, start/exit timestamps cleared. No missing journal proof was waived or relabelled PASS.

The exact sanitised dispatch result is retained at `/opt/ir35/.env.p6/33-owner-decoder-isolated-dispatch/one-watchdog-result.json`, sealed artifact SHA256 `0b147dd140e2fe315de75d38e0bd0136dce307608ae4ca3a1a39cd62ae07ad8f`. [Read-only stop report](p6/decoder-owner2-stop-report/01-sealed-dispatch-and-current-safety-result.json) independently verified its manifest and bytes; local report manifest `25ef682a6f4c7d246301e0399b898e6ec899ac4ccc8a1dc7f18bf49e9686b5e8`.

## Original rollback restored exactly within the approved state scope

The original container `ir35-p6-mock-worker-v7-fixedip-rollback` was retained, never removed or recreated. The temporary probe container is stopped and retained. The original rollback runs its same pinned image `sha256:691acf104f69f7cdf87dadf83370558886c8563fd9a22e1d8e99fb4c7e8f3e3f`, build `1c07c8507aa9049c6fe89c2f1c784fb2958084cf`, at fixed `172.18.0.241`, hard-read-only/processing-paused, browser/database ready and realAcceptance=false.

Before/after checks all PASS for: same container ID/image; complete Docker Config hash; Docker Env hash; HostConfig hash; protected worker/control env files, original Compose and proxy files; and operational state (running, Docker pause/restart/dead/OOM/exit flags, restart count, healthy status, private endpoint and paused/mock health fields). All exact hashes and state projections are in the full isolated result and immutable native before/after files.

Expected lifecycle timestamps were **not** falsely asserted identical after an authorised stop/start: StartedAt changed from13:40:13.800370541UTC to14:11:55.788176015UTC. Those timestamps are recorded separately; configuration, identity and functional-state equality are independently proved.

## Queue and mailbox safety after the stop

The read-only follow-up shows45application receipts, all terminal,50queue jobs,7completed schedule receipts and **one pending owned mock watchdog job**:

| id | kind / operation | state | created_at UTC | retry_count |
| --- | --- | --- | --- | --- |
| `0ec588ee-fbd8-4c05-8367-c7e0d5437fc1` | staging_mock_schedule / watchdog | created | 2026-10-26 14:11:55.388166 | 0 |

It was queued before the observability gate failed, but no durable execution receipt was verified. The original hard-paused rollback does not consume it. **It has not been drained, cancelled, republished, deleted, reset or marked completed.** Its presence is reported, not hidden as “no writes.” Processing only this acknowledged mock command would require a new owner decision.

Employer-URL payload count is0; the isolated dispatcher permits only the fixed mock watchdog schedule, not an application/employer body. The same unpublished SMTP sink has0messages/0returned messages, RestartCount0, unchanged StartedAt20October21:06:05.524915751UTC. No mailbox content or recipient was exported. Real acceptance remains false; no real employer or email workflow ran. Expected internal health/DB heartbeat traffic remains distinct from application processing.

## Full post-restore verification

| Requirement, both pristine and P5 copies | Result |
| --- | --- |
| 62exact counts + ordered MD5 / Auth hash parity | PASS |
| Two sequence states | PASS |
| Schema/RLS/grants/extensions | PASS, only same3approved extension-owner exceptions and2separately approved queue-role additions |
| Original552privilege baseline | PASS, unchanged |
| 73Storage object SHA256 | PASS |
| Original Caddy bytes/manifests/private fixture | PASS |
| pg_hba hash/order and original raw function finding | PASS, unchanged |
| FRESH112actual queue-role logins | PASS:8queue successes/104explicit app-clone rejections/0function calls |

The retained raw PUBLIC ACL finding is still reported as REVIEW_REQUIRED behind the separately approved queue-only HBA boundary; no customer grants/RLS/functions or secret values were changed.

## Next decision, not implemented

Propose making journal capture independent of cleared post-exit InvocationID: bind it to a unique public per-gate correlation and bounded unit start/end window, preserve sanitised stderr before evaluating status, and add an offline successful-one-shot/empty-ID regression. Do not simply drop the observability assertion. Separately reconcile/drain **only** the already acknowledged watchdog row with no new publication before any newly authorised attempt.

No such repair or drain is applied. The full P6 allowance remains unexecuted, but cannot proceed past the failed prerequisite under the owner's any-failure STOP rule. P7/P8/P9 remain held. Source/evidence are committed locally, not pushed because the owner's push permission is conditional on full P6 PASS; PR57 remains draft/unmerged. No production/DNS/Vercel/cloudSupabase/Google/OCI IAM/network-resource/paid or secret-value changes; no cutover. This is an interim stop report, not completion of the migration.
