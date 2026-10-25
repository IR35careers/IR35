# P6 exact Object Storage accounting — 25 October 2026

Status: **Exact audit PASS; latest recovery STOP — SSH identity unloaded**. P6 worker phase is not complete.

**Latest owner-reopened result:** after a new normal browser sign-in, the actual read-only compartment check succeeded. The separately journalled05execution passed its45minute token guard with3159seconds remaining, then stopped at `ExistingSSHAgentKeyNotLoaded_NoAutomaticPrompt`. [Sealed result](p6/bastion-owner1-session-token-reopen.json), SHA256 `3e48b186761c4a58226e3e9607849c95a574c89778d677e79efa7e97a8ff8351`. No Bastion API/session creation, worker/guest/probe operation, access-rule, IAM, bucket, operational-secret or production change followed. No new full containment is claimed. The owner said to stop on a failed attempt; no retry or automatic key prompt. Fresh browser authentication worked; the remaining blocker is the unloaded SSH identity and owner reopening, not another Oracle login.

The audit ran on24October23:46UTC. On resume25October the one bounded continuation stopped before the existing-Bastion GET because the browser SecurityToken had expired and automatic refresh failed. [Sealed failure](p6/bastion-owner1-session-after-exact.json), SHA256 `4c7ac1fcc95a3ce9b9af86c9bc430ecd132d7b01892a690e474ca01d24c4681f`. No session was created; none needed closing. No guest command, worker restart, probe replay, IAM/network/secret/production change or new full-containment check ran. The next fresh tenancy-wide audit was never reached.

Local read-only metadata at25October07:39:18UTC showed browser age28,415seconds and token expiry24,818seconds earlier; this diagnosis made zero cloud calls and printed no credentials. This explains the authentication stop, not a storage-data mismatch. The prior audit remains immutable but is not fresh pre-create eligibility. Preserve every journal; no automatic retry under the owner's bounded-recovery rule. Fresh browser sign-in plus explicit owner reopening is required.

| Gate | Actual result |
| --- | --- |
| Bucket | ir35-backups; Standard; private; automatic tiering disabled |
| Current objects / stored versions / delete markers | 0 / 0 / 0 |
| Unfinished uploads / parts | 0 / 0 |
| Exact total bytes | 0 |
| Completeness | Two identical complete paginated passes plus unchanged bucket-list recheck |
| Object Storage requests | 12 GET/list; zero writes; no automatic transport retries |
| Limits | Below 16,000,000,000-byte 80% stop and stricter 8,000,000,000-byte owner cap |
| Offline regression | 358 Linux helper tests PASS; assertions and timeouts unchanged |

[Actual sealed audit](p6/exact-storage-01-after-browser.json), manifest SHA256 `79389e16722f0a77172c5ca10a0892d5b6b9e23c1bc6380ab4dac68a88ecd47b`.
[Preserved zero-request browser gate](p6/exact-storage-01-audit.json), manifest SHA256 `6630e292d141586e440fde0a2ca9be18f0f7f18da346e8acb6afd05959bdc2c1`.
The browser gate happened before any Object Storage request; owner sign-in completed. No tooling repair slot was used.

The exact counter checks current objects against stored versions without double-counting, enumerates every unfinished upload's parts, rejects missing/non-integer sizes and ambiguous tiers, and detects pagination loops, duplicate entries and changes between complete passes. Object names, upload identifiers and credentials never enter the public artifact. The existing estimate-only path remains fail-closed; only this separately sealed exact callback can satisfy non-empty-bucket eligibility.

The planned single session was not created. Probe reconciliation and full containment still must pass under separately reopened authority before further mock staging work. No Bastion, IAM, network, bucket, object, lifecycle, secret, production or cutover setting changed. Preserve all prior failed journals and counters. All PRs stay draft and unmerged; `YES CUTOVER` is absent.
