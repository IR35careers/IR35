# P3 ownership / ACL diagnosis — all 494 differences

21 October 2026. **DIAGNOSIS ONLY, not P3 PASS.** Read-only source and staging catalog queries; zero customer rows imported, zero DDL/role changes during diagnosis. Every original difference, both values (configuration values hashed), both original MD5 fingerprints and changed fields are in [the 494-entry JSON](oracle-p3-acl-diagnosis.json). No entry is omitted or waived. The original FAIL494 report remains unchanged.

| Category | Differences |
| --- | ---: |
| Function grants | 341 |
| View grants | 84 |
| Schema grants | 8 |
| Table grants | 0 |
| Sequence grants | 0 |
| Column grants / default privileges | 0 / 0 |
| Function owners (definition hashes identical) | 49 |
| View owners (definition hashes identical) | 2 |
| Extension owners (versions identical) | 3 |
| Role existence / attributes / memberships | 1 / 2 / 4 |
| Other object differences | 0 |
| **Total** | **494** |

The 61 non-grant entries are 54 ownership entries and seven role entries. Table/column/constraint/index/sequence definitions, RLS enabled/forced flags and both policy predicates match in this comparison. That does not imply full migration or effective-permission PASS.

## Proven causes

1. **Not `--no-owner` or `--no-acl`.** Neither flag was used. The first clone ran as the existing `supabase_admin` superuser with `--single-transaction --exit-on-error`. The private archive contains 181 ACL TOC entries, including 24 DEFAULT ACL entries, and zero TABLE DATA entries. Default privileges and normal app owners/grants actually match. The previous restore did not retain a full private verbose log; any newly authorised restore must do so.
2. **Extension creation identity.** `pg_stat_statements`, `pgcrypto` and `uuid-ossp` were recreated as the restoring superuser, not cloud owner `postgres`. Their 49 function and two view owners follow that difference; all function/view definition hashes are identical. The archive has CREATE EXTENSION statements, but zero ALTER EXTENSION OWNER statements. PostgreSQL does not offer ALTER EXTENSION OWNER. This also accounts for grantor changes around those extension objects, not absent app ACLs. Do not make `postgres` SUPERUSER or write system catalogs to conceal it. The native image already has Supautils and the required extension allowlist; a supported, source-matching extension-creation path must be proven before restore.
3. **GraphQL schema initial ACLs are not in the dump.** Both cloud schemas `graphql` and `graphql_public` have current ACL hash equal to `pg_init_privs.initprivs`, type `e`, but no current extension dependency. The archive emits **zero** GRANT/REVOKE statements for either schema. The new database therefore gets default ACLs, losing eight explicit grants (USAGE to anon/authenticated/service_role; USAGE WITH GRANT OPTION to postgres). This is a measured pg_dump/initial-privileges gap, not an owner-approved exception. Source ACLs must be restored explicitly from the read-only catalog under the original grantor.
4. **Cluster roles were not restored.** The earlier roles-only password-free export was retained privately, but the helper applied only missing non-privileged roles. Existing bootstrap role settings and memberships remained. `supabase_admin` and `supabase_realtime_admin` differ only in configuration fingerprints; flags match. Three bootstrap SET memberships of the Realtime role are extra, and `postgres -> cli_login_postgres` is missing. The extra `supabase_functions_admin` role was created by our slim bootstrap prerequisite, not by cloud; dependency/security review is required before any removal. Passwords are never copied or reset.

[Live platform/archive metadata](oracle-p3-platform-diagnosis.json) records the initial ACL hashes, exact missing schema statements, native/cloud extension support and Supautils settings. [PostgreSQL extension packaging](https://www.postgresql.org/docs/17/extend-extensions.html) explains extension member/initial privilege handling; [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html) documents preserved owners/ACL defaults; [Supautils](https://github.com/supabase/supautils) documents supported privileged extension installation without granting SUPERUSER.

## Effective privileges — independent security gate

[Actual fresh read-only comparison](oracle-p3-effective-privileges.json): 552 object/role entries on each side, covering all observed non-system schemas, every table/view/sequence/function, and `anon`, `authenticated`, `service_role`. Uses `has_table_privilege` / `has_function_privilege` plus schema/sequence checks and WITH GRANT OPTION. Source catalog hashes still exactly match the historical source (timestamps excluded).

Result **FAIL: six missing schema-USAGE privileges**, the two GraphQL schemas for all three roles. **Zero more-permissive entries** in that three-role matrix; table/view/function/sequence effective privileges match. This does not waive grantor/owner/global-role differences. It does not execute a customer query or prove an RLS predicate by probing customer data; exact RLS definitions remain a separate required gate.

Fresh role definitions/attributes/memberships were exported read-only with `--roles-only --no-role-passwords`; raw role/config catalog artifacts are only `/opt/ir35/.env.p3-acl-source-*`, ir35/600. Public evidence contains names, booleans, counts and hashes, never passwords or raw settings.

## Next authorised action

**Subsequent coverage correction:** the original494 catalog omitted rolvaliduntil. Later supplemental read-only verification found a fourth residual repair finding after the catalog reduced to3: cli_login_postgres expires in cloud but not staging. This is a security STOP, not grant parity or a platform waiver. See [current repair result](oracle-p3-acl-repair.md). All494 entries here remain historical and unchanged; no untested all-role-attributes claim is made.

Commit this diagnosis to draft PR51 **before** a role repair. Roles-first, dependency-checked staging alignment, supported extension owner creation and explicit source ACL replay must precede a new clean, unattached schema-only target restore, with owners/ACLs/defaults intact and a private full log. No schema filtering, skipped errors, temporary SUPERUSER or system-catalog patching. Expanded fidelity and effective privilege gates must both reach zero. Genuine platform-only remainder: individually propose it and stop; no self-approved exception. Draft52 remains unexecutable; P4/P5 and customer-data rehearsal remain blocked.

Initial diagnostic tests: four Linux helper tests and one real PGlite inherited table/function privilege test PASS. Full final-source checks are reported separately, never inferred here. No production, cloud data/schema, Vercel, DNS, IAM, billing, runner acceptance or cutover change.
