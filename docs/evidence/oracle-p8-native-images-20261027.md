# P8 native web/mock images — PASS, not runtime activation

Source: `679dc8c234c525e9ebb246d2efbea857b6a5b660`. All eleven exact-source hosted checks completed successfully before execution; their IDs are retained in [the exclusive intent](p8/native-webmock-images-01/intent.json).

The new image-only slot is now **USED/PASS**. Do not replay it. [Sealed result](p8/native-webmock-images-01/result.json), [native observations](p8/native-webmock-images-01/native-result.json), [artifact manifest](p8/native-webmock-images-01/manifest.json). Manifest SHA-256: `834f7bc0c620e3030c0890db526ad57f0dd85fbc2ab0309078cdcd71f3933b53`.

| Gate | Observed result |
| --- | --- |
| Existing A1 resource, mount and Docker data-root guards | PASS; no OCI resources created |
| Original containment before build | PASS |
| Next.js image | PASS; native linux/arm64, non-root 1002:1002, 107.948 s |
| Worker image | PASS; native linux/arm64, non-root 1002:1002, 1.324 s |
| Network-none image probes | PASS; worker import only, no setup/consumer activation |
| Original containment after build | PASS |
| Original three container IDs/images/restart states | Unchanged |

Immutable local image identities, retained on the existing VM:

- Web: `sha256:a0bfd695b40349c444297d86dfb5afe7d0fdde7c0aa84378ec1a791a299eff39` (614,874,896 bytes). Actual image packages: Next 16.4.3, React/React DOM 19.2.9, Sharp 0.35.5.
- Worker: `sha256:86e5c87ae8c4cac8ea372c52596fb7b156d320cebe3585182cb50689d1530ea0` (5,831,927,955 bytes). Actual packages: Playwright Core 1.61.0, pg-boss 12.38.0. Import exposes only the three intended runtime exports.

Minimum observed OS available memory during the web build was 6,759,668 KiB (above the unchanged 2 GiB stop threshold); during the cached worker build, 8,740,740 KiB. These are build observations, **not** a writable application load test or a new billing proof.

Post-build pristine and original P5 checks each passed all 62 table counts/ordered MD5s, 27 Auth tables/password-hash coverage, two sequences and the unchanged 552 privilege baseline. Only the three approved extension-owner exceptions and two separately approved queue-role additions apply. All 73 Storage hashes match. Fresh HBA tests: 112 PASS, eight queue logins, 104 application-database rejections, zero application-function calls. Source/pristine/P5 writes: zero.

The original images remain available. No application/worker/Caddy configuration was switched; no queue setup, provider, email, credentials, IAM, networking, DNS, cloud project or production setting changed. `APPLY_RUNNER=mock` and real acceptance=false remain guarded. The next writable QA stack must be separately owned/disposable, use its own backend and retain full containment; this build is not evidence that those browser, save/apply, Realtime or restart gates passed.

P8 remains incomplete. Encrypted backup/restore and monitoring still require the outstanding batched owner decisions; exact managed-Storage reverse migration remains unproven. P9 remains preparation/NO-GO only. No merge or cutover occurred.
