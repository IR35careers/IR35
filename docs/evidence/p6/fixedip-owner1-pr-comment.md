## Owner-approved fixed-IP repair: restart PASS; full P6 FAIL / STOP

The ONE authorised staging repair and ONE full run have been used. No retry or repair followed failure. No source push, merge or production/cutover change.

- Fixed Compose IPv4 `172.18.0.240` on the SAME internal bridge, loopback proxy and sandbox /32: PASS. Existing candidate imagea4dd/sourceb55 reused, no build/new network.
- Native lifecycle29: **130 checks PASS**, including original34receipt preservation, earlier failures1/2, strict owned schedule durability, ONE restart and unchanged IP/direct-localhost build SHA. Manifest `44f7fd6e2e8d1ac1d6c7353c03f6b79e185d3920e6ecee6ae2a017db34daa0b0`.
- Integration30 reached full apphealth200/all five dependenciesready, SDK boundary gates and Realtime TLS-WebSocket101/join/broadcast before the failure.
- **FAIL:** actual systemctl mock-schedule dispatch, `Staging command failed: systemctl; exit=1; output suppressed`. Full wrapper28 manifest `7296fe41c92e3b760c9d80dc984b44ea8d9d10033c887bad1e22f00255ba43c0`; integration failure `272d214d8295018ea7f81a88b38cc65cdc188fe2fd8fde3b3647d46cd00b0b87`.
- Offline source reproduction identifies a decoder bug: existing env values are single-quoted; the new dispatcher retains those quotes, so its64hex validation sees66characters and rejects before HTTP. Native raw child stderr is not retained; this limitation is explicit. No secret value changed, no parser fix applied.
- Automatic rollback **PASS**: original app containers/restart policies restored, timersdisabled; previous digest691acf10/source1c worker at fixed172.18.0.241, healthy/browser+DB/processingpaused/realAcceptancefalse. Rollback manifest `38ef0fd585e745cf045a6a1359b6a09ba44ed6f8d91e4a74aa0d087fe5da4cc0`.
- Fresh postrollback **62counts/orderedMD5/Auth/2seq/3approved exceptions/552baseline+2queue roles/73Storage hashes +112actual HBA checks PASS** (8queue successes/104app rejects/0function calls). Original raw PUBLIC ACL finding preserved unchanged behind the approved HBA boundary.
- Offline preparation:488Oracle helper testsPASS. Optional sealed-evidence readback collector then had a tooling error; its failure was preserved/no retry, and no additional fresh SMTP/aggregate queue snapshot is claimed from it.

Detailed report and all public results are committed **locally**, not pushed because push was conditional on fullP6PASS: `docs/evidence/oracle-p6-fixedip-stop-20261026.md`, `docs/evidence/p6/fixedip-owner1-full/`. The existing2OCPU/12GB/150GB allocation was reused; no OCI/paid resource/new build, provider/DNS/production or credential-value change. Billing not freshly queried, no new £0 claim. Protected private routing copy stayed VM-only600 with identical credential values; original files remained unchanged.

P6 remains FAIL, P7/P8/P9 unstarted. Proposed next owner decision: strict env-decoder + sanitised dispatcher observability repair with offline boundary/loopback tests BEFORE considering another separately approved bounded fullP6 run. **Not applied. STOP / wait for owner.**
