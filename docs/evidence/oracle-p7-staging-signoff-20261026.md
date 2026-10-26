# P7 protected staging evidence — email/Auth and signed Storage PASS

Draft [PR61](https://github.com/IR35careers/IR35/pull/61), based on the unmerged P6 branch. This is not production or cutover approval, and not proof of a real Google login.

| Gate | Result | Immutable proof |
| --- | --- | --- |
| G3 source settings + explicit owner NONE confirmation | CLOSED | `oracle-g3-owner-confirmation-20261026.json` |
| Source-configured disposable Auth cases | PASS | `p7/auth-rehearsal-03/manifest.json`, SHA256 `67a1051c0930d544a02d86706a0b02fb29bab59de910266a46f0020f5c219595` |
| Password grant, refresh, owner/cross/anon profile RLS | PASS | Synthetic user only; no original password retried |
| Magic link, recovery/password login, old-session revocation | PASS | Private sink; original cloud hashes preserved |
| Signup/confirmation, invite, two-step email change | PASS | Three disposable DBs/fifteen containers removed; six private sink messages |
| Signed Storage downloads | PASS | All73 objects/1,241,375 bytes match SHA256; `p7/storage-readonly-01/manifest.json`, SHA256 `f0c38ace30f2dc3dc87e2704567014706afb51ed3be60e37b364e721477c3ffe` |
| Private bucket access | PASS negatives | 73 anonymous and73 unrelated-user denials. Named-owner reads0/public reads0: snapshot has no qualifying named-account object/public object. Do not claim positive owner coverage here. |
| Full containment after Auth and Storage | PASS |62 table counts/orderedMD5/Auth,2 sequences, only3 approved schema exceptions,552 original privileges + approved queue additions,73 physical Storage hashes,112 fresh HBA checks |
| Hermetic helper suite | PASS |575 tests/40.209s; `p7-storage-hermetic-01/result.json`, no private files/real keys/VM calls |
| Google provider/real SMTP | DEFERRED owner gates | [Exact OAuth plan](../oracle-oauth-redirect-plan.md); Google disabled on rehearsal; no real mailbox test authorised |

Failed Auth slots01/02 and their causes/cleanup remain recorded. Final03 is consumed: no replay/attempt04. Signing URLs happened only on the existing read-only P5 fixture; no customer data, policy, grant or cloud changes. Full provider-connected P7 release signoff is NOT complete until G4 and owner-secret/live-mail gates are satisfied; latest owner order permits P8 staging work with OAuth preparation only. Mock applications and sinks remain mandatory.

OCI refresh already failed once. A new owner browser sign-in is needed for authenticated P8 cloud usage/backup/monitoring work; defer to the single final batch, never loop refreshes. No current billing-zero claim is made from stale reports.
