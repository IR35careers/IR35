# P6 native mock lifecycle — repair in progress

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
| Latest source tests | 418 Linux helpers; 1,072 Vitest tests/160 files; 199 legacy checks; strict types, zero-warning lint, dependency/source-history checks PASS |
| Runtime repair1 and complete lifecycle | Pending; new stages15/16 only, never replay/reset stage12 or delete its four mock receipts |

Evidence: [original lifecycle FAIL](p6/native-mock-lifecycle.json), [isolated cause](p6/isolated-lost-ack-probe.json), [six-scenario repair PASS](p6/isolated-receipt-repair-one.json), [original build3 source FAIL](p6/worker-build-3.json), [CRLF source FAIL](p6/worker-build-3-source-repair-one.json), [final canonical image PASS](p6/worker-build-3-source-repair-two.json).

Final image: `sha256:bea1c9a5840c1856aa613967fcba4dac509a9e23a4d1b31fa83be0162c1ed844`, source `caaf4bdb0b9015b2afe3de943af7191228cf2004`, native manifest `f5399660280797e9f189affaaa6d3be5111b09083afa7cb34859bbde5b6f4393`. All three original build slots and both source-failure directories/journals remain. No further build/source retry is permitted. The VM still uses the old paused runtime until the guarded handover passes.
