# Verified backup and hosted preparation checkpoint

## What / why

Record real recovery evidence and migration 024 installation, rather than leaving the deployment runbook saying the backup is pending. Record the empty Railway project/service and the actual account resource-limit blocker. This is documentation only; no application/runtime code, CSP or RLS change.

## Verified operations

- Complete decryption/integrity + `pg_restore --list` + globals-header checks passed: auth/public/storage, 57 tables, 67 ACL entries, 16 roles, 19 grants. Independent ciphertext sizes/hashes match the outside-repo manifest. The owner received paths before DDL. Not a trial restore; Storage object bytes are not included.
- Reviewed migration 024 physically installed, private queue/watchdog/browser/service ACLs read back. No invocation, enqueue/requeue or application writes. Registered only physically verified 024 in the otherwise unregistered legacy CLI history; no blind `db push`.
- PR #21 merged after all 15 final-head checks passed at 67f04f4946c36674a38ead4ceb813209310f7ecd. Actual production still 0df1489e5e8c5351cd2a594ea5b194f7acba23eb.
- Created empty Railway project/service with one replica, sleep off, root Docker path, health/restart/drain settings. No source, secret or deployment. Requested 1 vCPU/2 GB failed because the account permits at most 1 GB. Region placement remains unverified.

## Tests / screenshots

`git diff --check`; authenticated read-only manifest/hash/database/resource-limit/production checks. No UI changes or screenshots needed. Application code was already verified by PR #21's complete release, security, Docker/Postgres and three-viewport browser/accessibility CI. This docs-only PR still runs normal CI; no exemption.

## Migrations / environment / manual actions

024 installed; 025 **not installed**, pending coordinated old-client compatibility. No environment variable values set or transferred. Queue logins/setup, secrets and standby deployment remain pending. Owner must review Railway workspace Settings > Plans and choose capacity allowing 2 GB; no billing change is assumed. A $30 usage notification is still required, not an unrequested hard shutdown cap.

Vercel Git deployment hold remains. No Google, DNS, Stripe, Postmark or production runner setting was changed. Never enable consumption or switch Vercel until literal **YES CUTOVER**. No destructive operation is authorized by the backup.

## Safe verification / rollback

Read back the resource limits after the owner's plan change, then continue the runbook's least-privilege setup and standby health proof. Staging uses only the mock ATS and anvesh.mannuru+ir35test@gmail.com; no real employer submission. There is no deployment/cutover to roll back. Retain encrypted recovery artifacts; do not drop the queue schema or restore managed roles blindly. All phases 0–7 remain active.
