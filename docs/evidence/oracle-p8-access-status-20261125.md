# P8 access and test status — 25 November 2026

This is a local working-tree report, not a release, hosted-CI signoff or complete P8 PASS. PR #62 remains draft at remote head `dc00103bb57fb42a06a87d7d5b0c4c2e308e1d75`; the new source/evidence has not been pushed by this handoff.

| Gate | Actual result |
| --- | --- |
| GitHub browser + CLI | PASS at 11:17 UTC. Browser reports device connected; authenticated CLI independently reads draft PR #62 as IR35careers. Credential source is the system keyring. No token or device code captured. |
| Oracle | PASS: SecurityToken profile ir35, London; actual read-only compartment GET returned ir35 ACTIVE. No API-key fallback. |
| SSH | BLOCKED: last verified keyLoaded=false. The separately approved 02 entry ended after300.115seconds without a successful load. Both failed attempts remain preserved; no third prompt opened. |
| Exact Next/config advancement | PASS:35focused Python and3Next security cases. Exact16.4.6 pins, integrity, old/canary and historical-image rejection retained. |
| Full isolated Python suite | PASS918tests/131.6seconds, fresh HOME, no.ir35/private keys/VM calls. This proof binds its329-source pre-access-retry02 snapshot, not later source edits. |
| Latest full Node suite | FAIL:1311PASS/1FAIL of1312tests/178files, source index unchanged `e148a17f06e9f2e6888511daebbd5ba2e76f338be10e70e72ddb74bdfb4e1a12`. Only the real disposable PostgreSQL RLS regression exceeds the unchanged5000ms test deadline. |
| Focused RLS reproduction | FAIL:11PASS/1FAIL, same unchanged deadline,5820.7ms. No third Vitest gate run or timeout/assertion waiver. |
| Bounded phase diagnoses | Real synthetic RLS checks complete correctly, but bootstrap dominates: default7882.2ms total, supported V8-pool comparison6056.8ms, same-version Linux9578.1ms. None is a gate PASS or a demonstrated fix. No source/config changes from these diagnoses. |
| Native lifecycle/backup/restore/writable QA | NOT executed by this access handoff. New bounded lifecycle allowance remains unused; full P8 remains incomplete. |

Preserved evidence manifests:

- Exact pins: `eb174f94b60b0a0e41bc7f625957ed0fb060936c4bd7877bc5feb05e88789cc5`
- Python918: `726531e057639b2023e91b715577b96e3ecb8ead454ba5fbb541556f1ce2b96a`
- Focused RLS failure: `e1077312722fdcb5d1957a1b4ffbce75cd00d536d772f0264419a2996ea6bdf2`
- Default phase diagnosis: `a4348498eb8b3683fdd4db9aa1a3292bef23d0037a92bca8a35d19d8e949f88e`
- Supported-pool diagnosis: `16c3cd37d9eb33a3808f706a91176b78dd74e2e54817907ed1590c4b2caf635c`
- Linux diagnosis: `a8163cd41089f57b716beca9915836112bb302485a9d1d00829df16d107ed34e`

No code push or hosted check was triggered by this report. No merge, production/DNS/Vercel/Supabase-cloud/Google/IAM/network/secret-value/paid-resource change, real email or employer submission. No restoration or cutover performed; exact YES CUTOVER remains absent. All old failure artifacts remain immutable.
