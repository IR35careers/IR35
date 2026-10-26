# Oracle staging P6 — PASS, 26 October 2026

Draft [PR #57](https://github.com/IR35careers/IR35/pull/57), unmerged. This is staging signoff, not cutover or real-worker approval.

| Gate | Result | Evidence |
| --- | --- | --- |
| Offline repairs/regressions | PASS, 512 tests | Strict decoder remains proven; active InvocationID plus bounded unit/time fallback, fast-exit/redaction/one-start/no-proof-fails tests. No existing semantic assertions, hashes or timeouts relaxed. |
| Known pending watchdog | PASS | [Drain](p6/capture-owner3-drain/01-drain-result.json): `0ec588ee-fbd8-4c05-8367-c7e0d5437fc1` completed once, one matching mock receipt, no dispatch/republish/delete/reset. Same 50 job IDs; other 49 jobs and all 45 application receipts exact. Original rollback Config/Env/HostConfig/files/functional state restored; expected lifecycle timestamp changes separately recorded. |
| ONE full lifecycle | PASS, 152 checks | [Full result](p6/capture-owner3-full/01-full-result.json): old45 receipts exact/56total; all outcomes and visible errors, idempotency/durable queue acknowledgements, cancellation/watchdog, one Chromium maximum, no browser orphans, invalid400/maintenance503, three new schedules and their own receipts. Earlier failures1/2 pass. |
| Restart / fixed IP | PASS | One actual restart, unchanged `172.18.0.240` and explicit IPAM pin. Direct and loopback proxy source/build identity match. Same pinned ARM image `sha256:a4dd534d942dbbdf68f6c1d3f8ed7c760b8ccf409105a07e5d4dfc928c96dbc7`, source `b55dafd709d6b00307b912c50cc3e3883087897a`. Previous `sha256:691acf104f69f7cdf87dadf83370558886c8563fd9a22e1d8e99fb4c7e8f3e3f` retained for rollback at `.241`. No new image or network. |
| App / API / Realtime | PASS | Full result integration: health200/all5 dependencies ready, SDK401/401/200, maintenance503/no-store, actual TLS WebSocket101/join/broadcast. Original protected Basic auth/noindex/CSP/cookie controls preserved. |
| Actual systemd schedules | PASS | [Sanitised sealed proof](p6/capture-owner3-journal-proof/01-sealed-schedule-journals-result.json): all3one-shots exit0/Resultsuccess/ExecMainStatus0; active InvocationID captured for each, journalread0, bounded time window. No stderr messages. Separate durable mock_ingest/mock_automation/watchdog receipts; fresh correct-build heartbeat/active0. Services use `unless-stopped`; schedule units are mock-only/private-loopback. |
| Complete containment | PASS | Full result:62table counts+orderedMD5, all Auth/hash checks,2sequence states, schema parity except3approved extension-owner exceptions, unchanged552privilege baseline plus approved2queue roles,73StorageSHA256. Fresh112HBA real logins:104application/clone rejects,8queue successes, zero function calls. Original inherited PUBLIC function ACL finding remains recorded as REVIEW_REQUIRED; owner-approved connection boundary is not an ACL waiver. |
| Mock / email / egress | PASS | APPLY_RUNNER=mock, real acceptancefalse, private SMTP sink0. Exact owned mock payloads plus immutable provider-free runtime and internal-only network establish no real employer/mail execution; no historical packet capture is claimed. |

## Immutable manifests

- Known-job drain: native `aa21723d53e2248ee23292e9636f16b9e650f61054612fbebac853fd3036c15a`; local `f5a4db5e774d771e94ee09142f3e71adb9d70a88c83b04138403cdf5c7f6dc66`.
- FullP6: native `ef7f9bfcc3c48737dcb8bf6a69e3850fc611165cc519f987e2d42c3bf0985f4f`; local `5b51ba02d4785d1ddd7dab874c8622a57c163f40adbc9bc26598633259325c24`.
- Lifecycle37: `90725082554c7356921aa3c87f31e614f0432b7f8ae13ddc51cf3f45aabb9f59`.
- Integration38: `40764ac92e8764976792ac929dc3ea4fbeafbcbc0f4a279abb0c01577acba60d`.
- Sealed journal proof: `9d65ac874e1b25462f9abd4f0c272758b96825b7e1471893e9bf2087f768a23a`.

All previous failed journals/counters/fixtures remain unchanged. No production, DNS, Vercel, Supabase cloud, Google, OCI/IAM/network-resource, secret-value or paid-resource change. No infrastructure was created, and no new billing-zero claim is made. P7/P8 continue; P9 preparation only. Literal YES CUTOVER remains absent.
