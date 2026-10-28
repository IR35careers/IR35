# P8 new QA-edge CI gate — final repair2 prepared, native HOLD

The [second actual CI failure](oracle-p8-private-edge-ci-failure2-20261028.json) is retained: exact4296f54, job122853907724, step`caddy-adapt`, Docker exit255, safe source location captured, cleanupPASS, seal`5a9021d73b2829bc6ad8230e87d34c8746a5738f1d6480d1f375687115b8d2e8`. The actual route cases were not reached. Observability repair1 identified the command but its reused wrapper still discarded stderr; no exact underlying OS/Caddy cause is invented.

Repair2 aligns this **CI synthetic fixture only** with the already-PASS original SDK harness: nonroot's explicit UID/GID and700 tmpfs paths rather than root-owned shared1777 mounts, and the same Caddy-only NET_BIND_SERVICE capability on validation/synthetic Caddy. The separate VM Compose plan remains cap-dropALL/no added capabilities/no published ports/read-only; no VM permission or runtime change is made. This tested-context difference is a repair hypothesis, not a proven permission-error diagnosis.

The Docker wrapper now retains exact exit code and original stderr length/SHA256 plus a bounded public-fixture-only sanitised projection. It strips the public fixture password/token, bcrypt and Basic/Bearer values. It is **not bundled or used on the VM**, and cannot capture operator keys, customer data, VM env files, tokens or real credentials. Full case records, safe code locations, cleanup and sealed results still publish even on failure. No gate assertion or timeout is changed.

| Offline check | Observed result |
| --- | --- |
| Focused custody/redaction/exclusive-failure tests before final code propagation | 6 PASS /0.120s |
| Full fresh-empty-HOME helper suite | 686 PASS /56.629s;0VM/private files/keys/no.ir35 |
| Suite manifest | `c932c901d12a4d9b61fbb4b97e677e53dcfec05f91cf32da67cc48e486e44c29` |
| Final code-propagation assertion | Focused rerun required after this report is written |
| App/JS/runtime changes since1297unit/199legacy proof | None |

[Result](p8-qa-edge-repair2-hermetic-01/result.json), [manifest](p8-qa-edge-repair2-hermetic-01/manifest.json). Prior1/2 failures remain unchanged. The next hosted observation is the **third same gate**; another failure is a hard STOP, no fourth push/replay or VM/native continuation without owner review. Success still does not mean P8 PASS: a complete bounded fixture controller and native UI/Auth/CDC/callback/restart/cleanup, backup/restore/reverse/monitoring gates remain. PR62 stays draft/unmerged, P9 preparationNO-GO, backup owner batch and exactYES CUTOVER hold unchanged.
