# Owner-approved queue HBA boundary — prepared, auth gate

## Latest native result: PASS

[Sealed native result](p6/queue-hba-owner-boundary.json), SHA256 `bd9c213cca63421095c083de1f5f68b92e652e3ba73f0199d6c123c549ff3d33`.

| Gate | Actual result |
| --- | --- |
| Original backup | `/opt/ir35/.env.p6/10-owner-queue-hba-boundary/pg_hba.original.conf`, ir35/mode400; SHA256 `a925911753f4975548eb4079177441c886aa22b6dd69f2b0cff98f779fb0b66a` |
| Current HBA | SHA256 `443eb1cee65e0cec7f947026c892426c6bd979a5a85678a75ba3a9d9e4724c68`; original uid100/gid101/mode0755 preserved |
| First-match rule order | 34 managed rules before every original rule; app/clone explicit rejects, queue-only SCRAM, other/future DB and replication rejects; local/IPv4/IPv6 |
| Real password-authenticated probes | 112: 8 queue successes, 104 explicit HBA rejects, zero failures; both roles across all 14 connectable DBs and all 4 transports |
| Disabled database | template0: explicit reject rules plus existing server connection-disabled state; no disabled setting changed |
| Postgres | Reload acknowledged; postmaster start unchanged; no restart |
| Function ACL observation | Same raw REVIEW_REQUIRED finding, unchanged source definition/grants; no invocation; application DB connections rejected |
| Full containment | PASS: 62 counts/ordered MD5/Auth, 2 sequences, 3 approved owner exceptions plus 2 queue roles, original 552, 73 Storage SHA256; old manifests/Caddy/fixtures unchanged |
| Forbidden mutations | Zero customer/grant/role/password/OCI/network/production writes; worker starts0 |
| Offline suite | 404 complete helper tests PASS |

The earlier access gate below is historical and retained. Fresh G2 and exactly one owner-approved new four-hour SSH lease now verify, and the interrupted inspection stage was independently ABSENT before a new read-only inspection PASS. No new Bastion session was used. Continue only the distinct gated post-boundary mock handover and remaining P6 checks; no phase completion or cutover claim.

## Earlier preparation and access gate (preserved)

Final local regression: **402 Linux helper tests PASS**, including 11 HBA/credential/reconciliation tests, 4 independent boundary-proof tests and 7 guarded handover tests. Source-only validation does not substitute for the pending native denial/containment gates.

The distinct post-boundary handover remains disabled until an actual sealed HBA PASS exists. It verifies the native result bytes against the supplied report (an edited public PASS cannot replace a native FAIL), retains raw function ACLs as REVIEW_REQUIRED, and requires every role/database/transport proof, full containment, current HBA hash/custody/first-match ordering, unchanged inventory and queue-only active sessions before and after handover. Failed stage09 remains unchanged; the new slot is not executed and no runtime assertion is weakened. The queue database may never receive an application restore.

The owner approved staging-only connection restrictions on 25 October 2026. This supersedes the earlier no-HBA-change hold **only for that repair**. The original [function finding](oracle-p6-function-scope-stop.md) and failed stage09 are retained; no function/ACL/RLS/role/password exception is introduced.

| Gate | Actual result |
| --- | --- |
| Explicit app/clone rejects before queue-only SCRAM allows/general rules | Source generator and parser-order tests PASS; not activated |
| Exact private original-byte backup/hash; reload only; same postmaster start | Implemented, not executed |
| Actual queue login + app/clone login denial over Docker TCP, Unix socket, IPv4 and IPv6 loopback | Harness tested with synthetic process fixtures; native checks pending |
| Bad password/refused socket/wrong identity must not count as HBA denial | Unit PASS |
| Failed denial restores exact backup, reloads and stops | Unit PASS, no native failure/rollback occurred |
| Full unchanged baseline containment before/after live change | Required, not newly executed |
| Original helper suite | 394 PASS before additional credential/reconciliation tests |
| Source/history scan | PASS, 1,264 tracked files at preparation commit e11e2d8 |
| Read-only live inspection | Terminal STOP / KeySafetyError; no HBA apply was invoked |
| Independent local credential check | Existing 4-hour key expired/unloaded; one OCI refresh failed; owner sign-in required |

[Write-once observation](p6/queue-hba-owner-inspect-stop.json). A live process was checked, then the **same** tool handle returned terminal exit1; no inspection/recovery was restarted solely because observation elapsed. No fresh containment PASS is claimed. The remote inspection journal may be absent, complete or partial and must be reconciled before another inspection; do not reset it. No new Bastion session is authorised.

Next owner batch: normal Oracle browser sign-in/MFA, and permission for one new native hidden `ssh-add -t 4h` lease on the existing encrypted key (the previous four-hour lease expired; its prompt receipt must remain intact). No API passphrase, password/key rotation, production action or cutover is requested. After access is restored, resume the exact approved repair; any denied-login/containment failure restores/reloads the backup and stops.
