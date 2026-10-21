# Oracle P3: protected ARM staging and explicit schema mismatch gate

## Superseding owner decisions — native schema PASS, three conditional exceptions only

| Gate | Result |
| --- | --- |
| Unused CLI role / expiry only / all other attributes unchanged | PASS:235 operational checks/0 references,16 expiry hashes match; no password change |
| Exactly one clean direct-owner attempt | Completed as postgres/non-superuser; platform delegated to supabase_admin, rollback clean; no retry/catalog edits |
| a admin owner; b all object ACLs; c app/DDL capability; d versions | PASS independently on both targets:62ACL incl4types/55members/198capability/552privilege entries/0broader, versions exact |
| Final clone / independent fresh baseline | Both PASS:3752objects each,0unexplained differences, exactly3 owner-only exceptions |
| Full customer-data verification / runtime-on-clone / app | Not yet run; schema-only, no data or full P3/P4/P5 signoff inferred |

See docs/evidence/oracle-p3-owner-parity.md and oracle-p3-owner-fidelity.json for each approved exception and all gate results. Baseline52 may now expose only the guarded installer tested on the independent empty target. Original494/FAIL4 evidence retained below as history. Existing source cloud, Vercel, production, DNS, customer rows, runtime flags and old targets untouched. No merge/cutover/paid resource; secrets/full logs only protected.env600/ir35.189Linux tests PASS; full new-head checks are separate.

## Latest staging ACL/role repair — actual FAIL4, security STOP / owner decision

| Gate | Result |
| --- | --- |
| All494diagnosed and committed before mutation | PASS at81a1363; full category/value/hash report |
| Roles-first flags/config/memberships, password-free export and dependency audit | PASS within original coverage; passwords unchanged |
| Supplemental16-role expiry check | **FAIL1/security STOP**: cli_login_postgres finite cloud expiry/no staging expiry; omitted rolvaliduntil |
| New unattached transactional schema restore with owners/ACL/default privileges/full private log | PASS once; ir35_acl_repair_20261021, original DBs retained |
|51function/view owners and two missing GraphQL schema ACL sets | PASS; definitions unchanged, no broad role/catalog workaround |
| Combined fidelity | **FAIL4**,3extension-owner records among3752catalog objects +1role expiry,0waivers |
| Effective anon/authenticated/service_role access, RLS/policies/grants | PASS;552entries/0diff/0broader; no disabled public RLS |
| Protected runtime | PASS; nine running/eight backend healthy; trusted TLS401/Basic/noindex/mock/sink/Studiooff |
| Exceptions / baseline52 / P4 / P5 | **PENDING OWNER / BLOCKED**, no waivers, no executable baseline or data/app deployment |

See docs/evidence/oracle-p3-acl-repair.md and oracle-p3-proposed-exceptions.json for all4findings. **Role expiry is a security repair omission, not an exception:** finite in cloud, absent on staging's initially password-null CLI role; no SQL write after discovery.552app-role PASS cannot conceal it. Owner batch: reopen exact expiry repair, then decide3cloudpostgres/native supabase_admin extension-owner proposals or direct exact-owner bootstrap. No temporary SUPERUSER, catalog writes or broad REASSIGN OWNED. Original494retained. Full restore log only /opt/ir35/.env.p3-acl-restore.log,600/ir35; no raw logs/configs/customer data in Git. No production/cloud/Vercel/DNS/IAM/billing/cutover changes.

Tests: actual inherited has_table_privilege/has_function_privilege PGlite regression plus helper tests; complete final-source verification reported in evidence after execution. New failure gate refuses before SSH. One local WSL Git-pointer bug repaired before any remote action; actual VM restore attempts1. No Vercel preview needed, no real employer submissions. Draft52 remains unexecutable: actual fresh-baseline0not yet proved.

## Latest owner-approved exact-cloud-first sequence —21October

| Gate | Actual result |
| --- | --- |
| Live cloud read-only schema/roles export | PASS; all11schemas, role passwords excluded, verify-full, raw artifacts only VM.env600/ir35 |
| New unattached clone schema restore | PASS once; original repo-built DB retained, no customer rows |
| Expanded exact-clone fidelity | **FAIL494**:433grants/49functions/3extensions/4memberships/3roles/2views;0exceptions |
| Tables/columns/constraints/indexes/RLS-policy/sequence definitions |0differences; not full parity |
| Original77 drift report | Complete: RLS15/functions13/other49; original grant coverage absent;11policies security-flagged |
| Pending upgrades / P4 / P5 | BLOCKED, not run |

See docs/evidence/oracle-p3-cloud-clone.md, oracle-p3-clone-gate.json and oracle-p3-drift-77.md/JSON. Snapshot/archive/role/private-file hashes and new attempt history retained. Explicittext/logical visible ordinals and duplicate rejection fix catalog helper truncation; invalid first comparison not treated as PASS. Owner approvals did not authorise waiving494differences, source repair, production or cutover.

Next is an explicitly reviewed isolated-target restore-fidelity repair (owners/ACL/default privileges/roles), not executed after this failed gate. Baseline reconciliation belongs in its own draft PR and cannot claim fresh-install zero differences yet. No raw schema/password/role config/customer data published; expanded nonsecret inputs are ignored local cache with public SHA256 bindings. Earlier77-only status below is history.

## What and why

Stacked on P2 draft50; existing P3 draft51, **phase incomplete**. Pinned official slim Supabase ARM images/PG17.6 extensions, VM-only scoped secrets/static environment loader, private services/SMTP sink/Studio off, actual protected staging HTTPS. Repaired empty-target bootstrap, Kong prefix/config and stale env binds without data reset/cloud writes. All24 migrations+legacy baseline passed. Read-only definition-hash gate **FAIL295/361objects,77differences**, so migration stops before customer data/P4/P5.

## Risk

Cloud still records024, target includes025 plus older schema/policy differences. Never waive app differences as platform-only, weaken RLS, install025 into cloud, or manufacture PASS. Subset gate is early rejection only, not full P4 verification. Proposed exact-cloud-clone-before-upgrade sequence needs owner direction, not executed.

No new OCI/IAM/paid/production/provider/env/DNS/acceptance change, restore or employer submission. Old projects untouched; no YES CUTOVER. Caddy private state only approved path700/600/UID1002/backup-excluded. Secrets outside Docker Env/logs/argv/Git; private SSH/API/age keys not on VM. No production RLS/CSP change. Vite8.2.4 fixes GHSA-698v-4r3x-3vcv without new exceptions.

## Test plan

1. Run strict types/ESLint, full Vitest and Linux unittest discovery. Gate tests reject025/policy differences, duplicates/malformed input and promoted/incomplete target. Equality never claims full verification.
2. Inspect docs/evidence/oracle-p3-staging.md/schema-gate.json: expect **FAIL**,295source/361target/77differences, phaseComplete=false/P4/P5 unstarted. Source catalogs contain metadata/names/counts/hashes only, not rows/passwords/object paths/live function bodies.
3. Review runtime/DNS/TLS reports; never repeat PASS stages/reset counters. Owner-held staging credentials only: both unauthenticated hosts401/Basic/noindex with trusted TLS; authenticated app503 setup placeholder. No public DB/Studio. No Vercel preview deployment needed/authorised.
4. Realtime health is not event replication proof; no browser login/load/restore/app readiness claim. Later E2E uses anvesh.mannuru+ir35test@gmail.com/mock ATS only, never customers/employers. Production verification waits for later gates.

## Migrations / env / screenshots / manual steps

Existing repo migrations executed **on fresh Oracle staging only**, none changed. No customer data copied. Generated secrets stay/opt/ir35/.env*600/ir35; mock/acceptance=false/SMTP sink/Basic/noindex. Private Auth exports remain P7. No new public env value. No UI screenshot: app not deployed. Local/hosted checks recorded honestly in evidence.

Owner decision: resolve exact-cloud-baseline versus all-migrations ordering before P4. Existing DNS/Caddy approvals complete, no repeated password/DNS request. Human review only; never merge/approve/auto-merge/close PR or deploy production from CI.
