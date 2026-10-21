# Cloud baseline: verified staging-only schema installer

## What and why

Separate baseline reconciliation stacked on P3 draft51, never merged. The owner's expiry/extension decisions are now proven on two independent native targets:3752objects each,0unexplained differences, only3conditional extension-owner exceptions. The fresh empty proof database was restored independently, not cloned from the repaired target. This draft exposes a guarded executable wrapper and hash-bound manifest, without publishing private generated SQL. Full gate/evidence: docs/evidence/oracle-p3-owner-parity.md / oracle-p3-owner-fidelity.json.

## Risk / migrations / env

Scope is guarded existing staging schema installation/reconciliation, **not production or a turnkey fresh-cluster bootstrap**. Cluster roles must match cloud flags/configs/memberships/snapshot expiry, with fresh staging passwords. Archive/source hashes, private600/ir35 custody, pinned SSH/disposable destination and durable attempts are checked. Existing RESTORED targets only read back; unknown/nonempty/failed targets stop. No catalog edits, app-role SUPERUSER, password change, normal migration-chain rewrite, source-cloud/Vercel/DNS/production change, new IAM/paid resource, merge or cutover. Private source SQL/logs never in public repo. Existing migration files and deployment holds untouched; no new workflow.

## Test plan

1. Run tests/unit/oracle-cloud-baseline.test.ts and Linux test_cloud_baseline.py/test_owner_parity.py. Assert actual proof hashes/counts/conditions, reject unrelated schema/role/privilege differences before SSH. Executable is staging-only and data verification remains false.
2. With existing pinned staging SSH/agent only, run python infra/oracle/cloud_baseline.py --staging-schema-only. Expect protected artifact/hash verification and idempotent read-back, not another owner probe/restore. No secret arguments or logs.
3. Inspect both native gates: all62ACL objects incl4types/55members/198DDL capabilities/552app-role privileges and16role expiry hashes match; only3exact owner fields excepted. Any other difference is FAIL.
4. Full customer-data/Auth/sequence/storageSHA256 verification, pending schema upgrades and service-on-clone integration remain later stages. No login/app/deployment readiness inferred from schema proof. Test-account/mock ATS only in later E2E; no employer submissions.

Screenshots: none, no UI/app deployed. Owner action now: human review only; no repeated DNS/password/Google/cutover gate. Later private Auth/Google settings remain owner-only as required. No production verification or release until all staging/cutover gates.
