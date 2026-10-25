# Owner-approved queue HBA boundary — prepared, auth gate

Final local regression: **396 Linux helper tests PASS**, including 11 HBA/credential/reconciliation tests. Source-only validation does not substitute for the pending native denial/containment gates.

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
