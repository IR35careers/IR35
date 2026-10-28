# P8 hosted private-edge regression: observability repair1, native HOLD

The [original hosted FAIL](oracle-p8-private-edge-ci-failure-20261028.json) remains unchanged. All other10 checks on exact`dcfc344f202926f02d4efb7b6d1491bca6eb7fdc` completed SUCCESS. The original seven-case SDK fixture still passed. The **new** synthetic edge regression failed and cleaned up, but its initial CLI printed only status/seal/cleanup, omitting the already-recorded case/error fields. Its precise root cause remains **UNPROVEN**; do not reinterpret it as PASS or invent a missing exception.

Repair1 publishes the complete redacted synthetic result, fixed per-step name and exception stack **filename/function/line only**. Unknown messages/locals/headers/command output are withheld; error text is emitted only from an exact fixed-code allowlist. The existing per-case write-before-assert and exclusive/sealed stage remain. An added regression proves an unexpected error's message is absent but its source location survives. No route, auth, RLS, case assertion, timeout or Docker image change is used to make the gate pass. The next CI observation remains the same bounded gate, not a counter reset. A third same-gate failure stops.

Independent local validation of the same synthetic Caddy handler tree passed **adapt and validate** using official Caddy2.10.2, whose Windows archive was verified against the publisher's SHA512. No service/listener, VM or real key was used. This does not prove Linux/Docker routing or identify the hosted failure. Two local checksum-parser failures (byte content/SHA512 width) and final successful verification are retained in the original failure report; no archive executed before verification.

Separately, QA image/env/Compose/drop-annotation wiring now accepts a newer source **only when the caller explicitly supplies the exact expected SHA and every nested proof agrees**. Original679dc8c default/proof/annotation tests remain intact; no old manifest/image/hash/slot changes. This is shape validation, not a substitute for the future controller's sealed-image/clean-source/hosted-green/ancestry checks. No new image has been built.

| Local gate | Result |
| --- | --- |
| New source-binding regressions | 5 PASS /0.004s |
| New edge observability/sanitisation tests | 4 PASS /0.081s |
| Full fresh-empty-HOME helper suite | 684 PASS /57.644s; no.ir35, keys, private state or VM |
| Write-once suite manifest | `61411c042843dd1a7b4e562ece3e61a84541f27d8273a884ab55d5350e19246d` |
| App/runtime/JS source diff from dcfc344 | None; its1297unit/199legacy/strictTS/fullLint proof remains applicable, not a newer runtime deployment |
| New hosted/native edge result | PENDING; original FAIL retained |

[Suite result](p8-qa-binding-hermetic-01/result.json), [manifest](p8-qa-binding-hermetic-01/manifest.json). Complete fixture-only logs remain in the existing ignored local paths. All PRs stay draft/unmerged. Native work remains held until exact-source hosted gates pass and the full bounded QA controller is complete. P8 incomplete/P9 preparation NO-GO; backup age/IAM owner batch unchanged, no production/provider/DNS/IAM/secret-value change or YES CUTOVER.
