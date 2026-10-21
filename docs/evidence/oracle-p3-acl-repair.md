# P3 ACL/role repair — FAIL4, owner decision required

21 October 2026. **Stopped at the owner's explicit security/proposed-exception gates. No exception is approved, P3 is not complete.** The initial post-repair catalog had3differences; an additional role-expiry check uncovered a fourth finding and a more-permissive attribute. No SQL mutation followed that discovery. Original FAIL494 and all77 earlier repo differences remain intact. [All494 diagnostic entries](oracle-p3-acl-diagnosis.json) were committed and pushed to draft51 at `81a1363183d3068fba5c0b4e7db4ba143dce15da` before any staging SQL mutation.

| Gate | Actual result |
| --- | --- |
| Diagnose all494 and commit first | PASS;433grants/54owners/7role entries, all cloud/clone values or hashes |
| Read-only cloud role export | PASS;16referenced roles, attributes/config/memberships, no passwords; private600/ir35 |
| Extra bootstrap role dependency audit | PASS; zero dependencies; only our known unused `supabase_functions_admin` removed |
| Roles-first flags/config/memberships read-back | PASS within original catalog coverage; fresh staging passwords untouched; see separate expiry FAIL below |
| Full role-attribute expiry check | **FAIL1/security STOP**; cli_login_postgres has finite expiry in cloud, none in staging;16roles checked |
| Clean isolated database / atomic restore | PASS once; new unattached `ir35_acl_repair_20261021`, previous databases retained; owners/ACLs/default privileges intact |
| Full private restore log | PASS; `/opt/ir35/.env.p3-acl-restore.log`, ir35/600,77104bytes, SHA256 `b7d350133dc6991798e07b0c5681db688d5ca772a4608a2d198e9cb649d441ff`; custody/hash independently read back |
| Function/view ownership repair | PASS;51supported ALTER OWNER operations, identical definitions preserved |
| Missing schema ACL replay | PASS; two schemas replayed from cloud under exact original owner/grantor; source grantability preserved |
| Catalog + supplemental role attributes | **FAIL4 total**:3extension-owner records among3752objects, plus1role expiry; encoding/collation match,3749catalog objects match;0waivers |
| Effective anon/authenticated/service_role privileges | **PASS**,552entries each side,0differences/0broader entries, including table/function WITH GRANT OPTION |
| Public RLS + policy/grant fidelity | PASS for the catalog checks; no public RLS-disabled table; all policy USING/WITH CHECK and object ACL hashes match |
| Protected runtime | PASS; nine existing services running, eight backend healthchecks healthy, trusted TLS/401 Basic/noindex at both staging hosts; mock/sink/Studio-off unchanged |
| Fresh-target baseline52 / P4 / P5 | **BLOCKED**, not executable/not run |

Machine reports: [restore](oracle-p3-acl-restore.json), [fidelity](oracle-p3-acl-gate.json), [effective security](oracle-p3-acl-security.json), [runtime](oracle-p3-acl-runtime.json). The new database is not wired to running services. Zero customer rows/objects copied; this is schema rehearsal only, not a zero-loss data PASS.

## Repair and self-heal record

The first invocation stopped locally before SSH because native WSL Git could not resolve the Windows-managed worktree `.git` pointer. One documented tooling repair supplies the mounted explicit `--git-dir`; native Windows ancestry and remote PR head independently verified. Local invocation2 then completed **one** journalled VM restore, not two restores. No retry/reset of old clone attempts. New marker records attempts1/RESTORED; every subsequent restore invocation refuses to replay it. The combined public FAIL4 also blocks the entrypoint locally before any authentication/SSH.

Role changes ran transactionally with ON_ERROR_STOP, followed by exact role read-back before database creation. Existing passwords were not read, copied or reset. List settings use set_config plus ALTER ROLE SET FROM CURRENT to preserve search_path parsing exactly. The known bootstrap role had zero shared/local dependencies before removal; no DROP OWNED, cascading drop, blanket ownership reassignment, system-catalog patch or temporary SUPERUSER grant was used.

The archive restored as the existing `supabase_admin` superuser using `--clean --if-exists --single-transaction --exit-on-error --verbose`, confined to the database created by this attempt. No `--no-owner`, `--no-acl`, filtered TOC, ignored restore errors or source mutations. The full stdout/stderr log stays private; only path/permissions/length/hash are public. Supported ALTER FUNCTION/VIEW OWNER then matched the51member owners; automatic PostgreSQL ACL owner rewriting matched the425extension grant entries. Exactly the two GraphQL schema ACL sets needed explicit replay. All default privileges already matched.

## PROPOSED exceptions — not approved, not excluded from FAIL

| Exact object | Version | Cloud owner | Native staging owner |
| --- | --- | --- | --- |
| extension:pg_stat_statements |1.11|postgres|supabase_admin|
| extension:pgcrypto |1.3|postgres|supabase_admin|
| extension:uuid-ossp |1.1|postgres|supabase_admin|

Each is a platform/extension-installation owner record, **not** a changed app object, policy, function body, member owner, ACL or extension version. The other3749catalog objects match, but the supplemental expiry finding below still fails. The native image/pins are unchanged; [platform evidence](oracle-p3-platform-diagnosis.json) and [original per-owner values](oracle-p3-acl-diagnosis.json) bind this diagnosis. [PostgreSQL17 ALTER EXTENSION](https://www.postgresql.org/docs/17/sql-alterextension.html) has no OWNER variant. This is not proof that exact ownership is impossible under a differently designed isolated bootstrap; that would need a separately reviewed, tested path. Broad REASSIGN OWNED also changes system/shared ownership, so it was deliberately not used. No direct catalog update or transient escalation to make the comparison pass.

## Security STOP — omitted CLI role expiry

`role-expiry:cli_login_postgres`: live cloud finite expiry versus staging no configured expiry, compared with UTC-normalised hashes across all16roles. The original expanded catalog and role builder did not include `rolvaliduntil`; therefore the earlier roles-match assertion covered flags/config/memberships only, not every role attribute. The initial clone created this role with `PASSWORD NULL`, not a copied cloud password. The role still has no staged password set by these helpers and the database has no public listener; nevertheless an unbounded expiry is a more-permissive attribute. **Stopped immediately; not repaired, not waived, not a proposed platform exception.** No database write followed discovery. The three app-role552-entry privilege comparison still passes; it cannot conceal this fourth failure.

The combined gate now includes the supplemental role-expiry result and fails even if someone labels the catalog/app-role matrix PASS. A regression proves that an inconsistent PASS label cannot hide a real expiry difference. Evidence stores role name, classifications and hashes only; no password/expiry timestamp is published.

## Owner batch

1. Decide whether to reopen the staging-only CLI-role expiry repair to match the source snapshot, without changing any password. This is a security repair omission, not an exception request.
2. Decide on [the three individually enumerated extension-owner proposals](oracle-p3-proposed-exceptions.json), or direct an exact-owner isolated-bootstrap repair. We do not self-approve or label the result zero differences. Accepting extension exceptions alone does not satisfy draft52's current **fresh target + baseline = actual0** requirement; that gate must be proved or explicitly revised by the owner.

No production, Supabase cloud, Vercel, DNS, OCI resource/IAM/billing, runner acceptance or cutover change. Original cloud services remain untouched. No next phase starts while this gate fails. Exact YES CUTOVER and separate real-runner approval remain mandatory.

## Local verification

`npm run verify:release` PASS: strict TypeScript, full zero-warning ESLint, **942Vitest tests/145files, zero skips**, **199legacy checks**. Linux unittest discovery **185tests PASS** (mocked OCI fixtures, no live create); actual PGlite inherited table/function privilege regression included. PowerShell parser, scoped final lint, whitespace and dependency audit PASS; only the two existing owner-approved dependency exceptions until29October, no new exception. Public source/history scan **877tracked files PASS**; final-head hosted CI remains pending, never inferred from prior head. These tests do not turn FAIL4 into PASS. No full P4 data/Auth/sequence/storage verification, login/load test or executable baseline proof is claimed.
