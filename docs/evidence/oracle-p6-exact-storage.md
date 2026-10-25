# P6 exact Object Storage accounting — 25 October 2026

Status: **PASS (read-only audit only)**. P6 worker phase is not complete.

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

Next: the owner's ONE unused existing-Bastion/existing-VM session, after another exact tenancy-wide audit immediately before creation. No Bastion, IAM, network, bucket, object, lifecycle, secret, production or cutover setting has changed. Probe reconciliation and full containment must pass before further mock staging work. Preserve all prior failed journals and counters. All PRs stay draft and unmerged; `YES CUTOVER` is absent.
