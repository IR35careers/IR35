# P6 native mock lifecycle — stopped for owner review

The separately approved read-only audit has now executed **once and stopped**. Logging-only source commit f87ee94 passed431helper tests, including11new per-step/command/error/redaction/write-once regressions. [Result](p6/status-owner-audit-two/result.json), [manifest](p6/status-owner-audit-two/manifest.json) SHA256 `7950d65bd52f898ab2cab0aee802ae22268bc205e81d147116656d607481a2bf`; all7artifact hashes verified.

| Reopened audit step | Result |
| --- | --- |
| Sealed historical evidence | PASS |
| Queue before | PASS: exactly12expected application/job IDs, all12receipts unchanged, no extra/pending jobs, schedules0 |
| Worker idle | FAIL: `docker top ir35-p6-mock-worker-v3 -eo stat,comm` exit1; preceding Docker inspect PASS |
| SMTP, full containment/audit tables, queue after | NOT RUN: stopped immediately, not waived |

The [command observation](p6/status-owner-audit-two/03-worker-idle-result.json) identifies docker-top and records stderr SHA256 `e6c2b6078fe8c0e47be00f553dd4f0ab861a8dd6571d7e1e58c5e8b08a7dcfff`. Its category is unclassified/output withheld; underlying ps/daemon cause is unproven. No real queue residue was found by the completed checks, but the full no-side-effects proof is incomplete. Owner's no-further-retry STOP applies. No worker-source fix, new image, deployment, restart, config/queue/DB/SMTP/secret/OCI/production write or phase advance occurred. Previous image/configuration never replaced, so no rollback was needed. The approved image and full P6 rerun remain unused; do not rerun the consumed audit or modify its evidence. The original failure history below is preserved.

Latest owner-approved continuation stopped at its **first read-only prerequisite audit**, before the HTTP-status fix, new image or P6 rerun. [Exact stop record](p6/status-owner-audit-one-stop.json): `Staging command failed: docker; exit=1; output suppressed`. The wrapper did not capture which Docker subcommand or intermediate results, so the new queue/audit/SMTP/worker no-side-effects proof is incomplete. A distinct read-only host diagnostic confirms ps and Docker CLI exist, not the underlying failure. No retry was attempted, following the owner's new explicit rule. New image/rerun allowances are unused; previous image/configuration were never replaced, so rollback was unnecessary. No source/service/queue/database/SMTP/secret/OCI/production changes or new containment PASS. Proposed prerequisite-tooling repair: individual write-once observations and safe operation-specific diagnostics, without raw Docker environments or secret output. Earlier immutable stage16 evidence follows unchanged.

Latest actual run: [stage16 FAIL](p6/native-mock-lifecycle-repair-one.json), manifest `b20410a43d14bc947590cf2b7f29e6104c5880b4199a2b6c155e78e5bde75ee9`. **33 checks passed; one failed.** [Sealed-case/read-only diagnosis](p6/native-lifecycle-repair-one-status-diagnosis.json).

Read-only diagnosis JSON SHA256 (canonical committed bytes): `b13fd3bb6d1e5dc9c59592862a0c451391b2e13b3624403f42d020432cf3d4ea`.

| Gate | Latest result |
| --- | --- |
| Access | One fresh browser sign-in and one approved four-hour hidden SSH prompt completed; actual fingerprint and read-only compartment check PASS |
| Retained receipts | All four original failed-run receipts unchanged |
| Six mock outcomes | Success, HTTP500, timeout, lost acknowledgement, CAPTCHA and unknown-answer exact histories/errors PASS; duplicate and durable job acknowledgement checks PASS |
| Concurrency | Two queued successes complete without overlapping browser intervals |
| Invalid employer-URL payload | **FAIL: expected400, actual202**; native artifact137 hash `6c1172472671d25dda6675040eb96db4fd4854362ccb8304bea6e57eda2eeeb2` |
| Durable queue after failure | Exactly12 expected retained/new application IDs and12 corresponding jobs; no unexpected/invalid job; schedules0 |
| Automatic containment | Worker paused, real acceptance false, restarts0; full62orderedMD5/Auth/2sequences/schema3exceptions+2roles/552privileges/73Storage SHA256 PASS |
| Post-stop connection boundary | Current HBA hash, raw unchanged public-function finding and112-login proof PASS; no ACL rewrite or function call |
| Remaining gates | Other invalid actor, maintenance, cancellation, watchdog, schedules and restart did not execute after this fail; app/Realtime/timers still incomplete |

Root cause: `response.writeHead(202).end(JSON.stringify(await store.enqueue(...)))` evaluates `writeHead` before awaiting validation. The strict payload validator rejects before a database transaction starts, but the catch sees `headersSent` and cannot replace202 with400. A credential-free localhost-only Node reproduction confirms this ordering. The invalid request was **not** enqueued; the false accepted status remains a failing API contract, not a waived test.

No live/source repair or extra build/run was attempted. The existing three-image/two-source-helper allowance is exhausted, and stage16 is immutable/consumed. Stop for owner review before a separately bounded image/run. Proposed fix: await successful enqueue before setting202, add a real HTTP regression for rejection/commit failure and valid acceptance, retain every original assertion/timeout and receipt. No production/provider/DNS/secret/cutover change or P6 signoff.

The chronology below is retained; statements that stage16 is pending are historical, superseded by the result above.

**Latest:** [runtime repair1 handover PASS](p6/mock-receipt-repair-one-handover.json), native manifest `acdecfdded0c163b68f4a5412a6f0825df947c9e0cd37108a0627f1d1a5bb2e4`. Final image3 is now active as private v3; old v2 is stopped/retained, original secret files remain unchanged. Full HBA/data/Auth/schema/sequence/privilege/Storage containment PASS. Complete lifecycle repair1 remains pending, with all four original failed-run receipts protected.

All evidence below is staging/mock only. No real employer submission, real email, production/DNS/provider change, role/grant/password change or cutover occurred. Full P6 app/Realtime/timer integration remains mandatory; this is not phase signoff.

| Gate | Actual result |
| --- | --- |
| Queue connection boundary | 112 real login checks PASS; 8 queue successes, 104 explicit HBA rejects; full containment PASS |
| Image2 handover | Native health/heartbeat/internal network/loopback proxy/source containment PASS |
| Initial lifecycle | Success, HTTP500, timeout, duplicate idempotency and durable queue acknowledgements PASS; lost-ack classification FAIL1, worker paused; all source data/security containment PASS |
| Isolated diagnosis | Bare image2/network-none/no secrets: pre-header reset causes Chromium2POSTs; child reports unknown/submissions2, parentmax1 rejects safely as mock_browser_failed |
| Receipt repair1 | Explicit JSON receipt and post-acceptance truncated body; six actual ARM browser scenarios PASS with 1 submission for success/500/timeout/lostack and 0 for CAPTCHA/unknown; unchanged hashes/parentguard/full containment |
| Build3 source failure | No Docker intent/log/invocation: nested-CWD archive contained only infra/oracle; original failure retained |
| Source helper repair1 | No Docker intent/log/invocation: CRLF export differs from tested LF bytes; hash guard failed closed, original failure retained |
| Source helper repair2 | Canonical Git LF bytes match unchanged native14 hashes; intended third image actually built once, native browser/version/ARM/nonroot/full containment PASS |
| Latest source tests | 420 Linux helpers including12 SSH-agent checks; 1,072 Vitest tests/160 files; 199 legacy checks; strict types, zero-warning lint, dependency/source-history checks PASS |
| Runtime repair1 and complete lifecycle | Pending; new stages15/16 only, never replay/reset stage12 or delete its four mock receipts |

Evidence: [original lifecycle FAIL](p6/native-mock-lifecycle.json), [isolated cause](p6/isolated-lost-ack-probe.json), [six-scenario repair PASS](p6/isolated-receipt-repair-one.json), [original build3 source FAIL](p6/worker-build-3.json), [CRLF source FAIL](p6/worker-build-3-source-repair-one.json), [final canonical image PASS](p6/worker-build-3-source-repair-two.json).

Final image: `sha256:bea1c9a5840c1856aa613967fcba4dac509a9e23a4d1b31fa83be0162c1ed844`, source `caaf4bdb0b9015b2afe3de943af7191228cf2004`, native manifest `f5399660280797e9f189affaaa6d3be5111b09083afa7cb34859bbde5b6f4393`. All three original build slots and both source-failure directories/journals remain. No further build/source retry is permitted. The VM still uses the old paused runtime until the guarded handover passes.
