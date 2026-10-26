# P6 fixed-IP repair and single full rerun — STOP

26 October 2026. **Full P6 FAIL. Automatic rollback PASS. No retry or fix after failure.** P7/P8/P9 have not advanced. The owner approved one staging-only fixed-IP repair and one full P6 run, with an explicit stop on any failure. That allowance is consumed, not reset.

## Results

| Gate | Result / evidence |
| --- | --- |
| Existing network/IPAM, conflict check, original images and mock isolation | PASS; [preflight](p6/fixedip-owner1-preflight/01-fixedip-readonly-result.json), manifest `08219c6fc466c198112e8fd9684a50d028c7722eafbe17b19a7972bac93d3bb8` |
| Fixed worker endpoint, existing image, localhost proxy and sandbox | PASS; [native27 handover](p6/fixedip-owner1-handover/01-fixedip-handover-result.json), manifest `e59553b9c73fff4a1b26dabd8608fabe14f03cf1df453c3fdb0f8eb3433d4c16` |
| All lifecycle assertions, including earlier failures1/2 and restart | PASS, **130 recorded checks**, [native29 nested in full result](p6/fixedip-owner1-full/01-fixedip-full-result.json), manifest `44f7fd6e2e8d1ac1d6c7353c03f6b79e185d3920e6ecee6ae2a017db34daa0b0` |
| Full app health and Realtime | Observed PASS before failure: app `/api/health`200, all five dependencies ready; protected Realtime TLS WebSocket101, channel join and broadcast echo. Native files listed below. Not a full phase PASS. |
| Actual systemd mock-schedule dispatch | **FAIL**: `Staging command failed: systemctl; exit=1; output suppressed` |
| Full P6 wrapper | **FAIL**, native28 manifest `7296fe41c92e3b760c9d80dc984b44ea8d9d10033c887bad1e22f00255ba43c0`; local [sealed result](p6/fixedip-owner1-full/result.json), manifest `df58ac31665bfc0e9d24894c1325fdaa612248939efdfff6f52bd27bd19ec2eb` |
| Original app/restart policies, timers disabled | Automatic rollback PASS, recorded in full result |
| Previous digest-pinned worker, paused and mock-only | Automatic rollback PASS; native32 manifest `38ef0fd585e745cf045a6a1359b6a09ba44ed6f8d91e4a74aa0d087fe5da4cc0` |
| Fresh post-rollback full containment and 112 actual HBA checks | PASS, `failureContainment` in full result |

No new worker image was built. The candidate used `sha256:a4dd534d942dbbdf68f6c1d3f8ed7c760b8ccf409105a07e5d4dfc928c96dbc7`, source `b55dafd709d6b00307b912c50cc3e3883087897a`.

## What the fixed-IP repair proved

The existing internal Docker bridge `ir35-staging_backend` has subnet `172.18.0.0/16`; `172.18.0.240` was explicitly configured through Compose `ipv4_address`, not merely observed as a temporary allocation. No new network or OCI resource was created. The existing localhost-only proxy and its sandbox `/32` both used that address.

The single lifecycle run restarted the worker once. Its configured and actual IP stayed fixed; direct private-IP and localhost `/health` matched the same build SHA after restart. No retarget was needed. Native cases `fixedip-direct-localhost-after-restart` and `restart-health` both PASS.

Earlier failure1 was explicitly rechecked: initial processing pause, authenticated resume, then `mock-health` PASS. Earlier failure2 was explicitly rechecked: `schedule-mock_ingest`, `schedule-mock_automation`, `schedule-watchdog` and **each new publication's own durable receipt** PASS. The stricter receipt check prevents old schedule rows from manufacturing a pass.

The run preserved all34 earlier application receipts exactly and verified new receipts across the six outcomes, idempotency/concurrency, rejected400/maintenance503, cancellation, watchdog and post-restart durability. No existing assertion, hash, catalogue or timeout was relaxed.

## Failure and offline root-cause finding

The app/Realtime integration reached readiness, then its systemctl schedule-dispatch step returned exit1. The child stderr was suppressed, so the native wrapper reports only the exact error above. No second dispatch, script repair, image rebuild or lifecycle rerun was attempted.

The dispatcher source deterministically mishandles the **existing** protected env-file format:

- The established `env_text()` writer stores `KEY='value'`; the strict existing `private_env()` reader validates and decodes that format.
- The new `p6_schedule_dispatch.py` instead splits at `=` and leaves the surrounding single quotes in the value.
- Its subsequent64hex validation therefore sees66characters and rejects, before constructing an HTTP request.
- An offline dummy-only reproduction records raw length66 / validationfalse; no actual secret was read, displayed or stored by that reproduction. [Evidence](p6/fixedip-owner1-stop-readback/result.json).

This is a source-proven decoder defect, not evidence of an incorrect/rotated credential. The native service's raw stderr was not retained; that limitation remains explicit. Proposed **next** repair only: use the same strict non-evaluating env decoder with custody checks, add quoted/malformed/duplicate-key and real-loopback dispatch regressions, and record a sanitised per-step result before any future gate. **Not applied; requires a new owner decision before live repair or another run.** No sourcing a shell file, removing encryption, changing the secret or relaxing the regex is proposed.

## Current safe rollback state

The candidate is stopped and retained. The active rollback is `ir35-p6-mock-worker-v7-fixedip-rollback` at explicitly configured **172.18.0.241**, using previous image `sha256:691acf104f69f7cdf87dadf83370558886c8563fd9a22e1d8e99fb4c7e8f3e3f`, source `1c07c8507aa9049c6fe89c2f1c784fb2958084cf`.

Its direct/localhost SHA equality, browserReady/databaseReady, processingPaused=true, active=0 and realAcceptance=false all PASS. The previous images, stopped containers, original Compose/env/proxy files, old failure journals and counters remain intact. No container or fixture was deleted.

The original P5 web/Kong containers were restored, and their original restart policies were restored. New systemd timers are disabled. The P6 integration's new private routing-config copy stays VM-only,600/ir35, with exactly the same credential values; no key/password/token was rotated or exported. Original private files and all original Caddy configuration bytes remain unchanged. Basic auth/noindex/maintenance controls were not weakened.

## Data and security after rollback

The automatic rollback completed the full verification on both pristine rehearsal and P5 app copies:

| Check | Result |
| --- | --- |
| 62 exact table counts and ordered MD5, including Auth hashes | PASS |
| Two sequence states | PASS |
| Schema/extensions/roles | PASS, same three approved extension-owner exceptions and two separately approved queue-role additions only |
| Original552 app-role privilege checks | PASS, unchanged |
| 73 Storage object SHA256 hashes | PASS |
| Original Caddy files/private fixture/manifests | PASS |
| pg_hba hash/order/queue-only boundary | PASS, hash `443eb1cee65e0cec7f947026c892426c6bd979a5a85678a75ba3a9d9e4724c68` |
| **Fresh112 actual login checks** | PASS: eight queue successes,104 explicit app/clone rejections, zero application function calls |

The original inherited PUBLIC function finding remains recorded unchanged, not filtered from the552baseline; the separately approved HBA boundary still denies queue logins to app/clone databases. No source-cloud or customer-data mutation occurred.

APPLY_RUNNER remains mock and real acceptance false. The failing dispatcher code rejects before HTTP. No real employer or real-mailbox workflow was used. No production/DNS/Vercel/Supabase cloud/Google/OCI IAM/network/billing/credential-value changes occurred. Expected internal health/heartbeat traffic is not called zero traffic.

## Evidence locations and limits

The full native result is committed locally at [fixedip-owner1-full/01-fixedip-full-result.json](p6/fixedip-owner1-full/01-fixedip-full-result.json). It includes the lifecycle cases, both rollbacks and complete post-rollback containment/112-login evidence.

Native integration artifacts are retained on the VM at `/opt/ir35/.env.p6/30-owner-fixedip-app-realtime-schedules/`, sealed manifest `272d214d8295018ea7f81a88b38cc65cdc188fe2fd8fde3b3647d46cd00b0b87`. `app-health.json` and `realtime-websocket.json` were read-only observed before the full wrapper finished: all dependency checks ready and WebSocket101/join/broadcast PASS. Those observations do not replace a full P6 pass.

A subsequent optional **read-only** sealed-evidence collector failed with KeySafetyError (its new projection refers to an unimported `digest` name). The write-once [failed collection](p6/fixedip-owner1-stop-readback/01-sealed-failure-rollback-result.json) and dummy reproduction were preserved, manifest `f15f4af21a2de82174d080950a2de509a722d5b4bdafcb36dc202e32c77f7d71`; **no repair or retry** followed. Consequently no additional fresh SMTP/aggregate queue snapshot is claimed from that collector. The already completed native rollback/containment result remains valid and is not overwritten or relabelled by this collector failure.

Offline preparation: all488Oracle helper tests PASS, including a live loopback proxy answering after a worker-process restart at an unchanged endpoint. This does not mean the schedule dispatcher had been tested end-to-end; the native failure exposes that coverage gap.

## Phase and cost report

| Phase | Status |
| --- | --- |
| P1–P4 | Existing owner-approved evidence preserved; not rerun or newly claimed complete here |
| P5 | Earlier SDK/runtime PASS preserved; original app restored |
| P6 | **FAIL**, schedule dispatch blocker; fixed-IP lifecycle130checks PASS does not complete the phase |
| P7 / P8 | Not started after this stop |
| P9 | Preparation/cutover not advanced; no DNS or cutover executed |

No OCI resources or paid build services were created. The established allocation stays one A1 2OCPU/12GB,50GBboot+100GBblock within the150GB approved envelope. This run used the existing VM, Docker network and images. Object Storage/billing were not freshly queried, so this is **not a fresh £0 invoice or current storage-usage assertion**.

No evidence/source push was made: the owner's push/CI permission was conditional on fullP6 PASS. PR57 remains draft/unmerged at the prior remote revision. This report is an interim hard-stop handoff, not a completed migration or cutover. **STOP and wait for owner review.**
