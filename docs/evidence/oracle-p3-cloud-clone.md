# Revised P3 exact-cloud clone —21October2026: fidelity FAIL

Owner approved exact-cloud-first staging only, with separate baseline/upgrades and no production/DNS/cutover. **P3 incomplete; P4/P5 not started.** Original source drift was not fixed in production or waived.

| Gate | Result |
| --- | --- |
| Existing SSH / account scope | Existing agent loaded, pinned guest; no repeated prompt/new OCI resource/IAM/plan/ingress |
| Source read-only export | PASS:PG17.11 native client/cloudPG17.6, repeatable-read READ ONLY, verify-full/approved CA/session pooler |
| Schema-only archive | PASS:428831bytes, archive list has no TABLE DATA/SEQUENCE SET; all11observed schemas included |
| Roles | PASS export5643bytes/no role passwords; existing VM passwords/role attributes not overwritten, only missing nonprivileged CLI role created with NULL password |
| Private custody | Three initial artifacts plus repaired catalog in/opt/ir35/.env.p3-*600/ir35; no raw SQL, password or customer row exported publicly |
| New unattached clone | Schema restore PASS once to ir35_cloud_baseline_20261021, same Postgres container/3GiB shared limit; original repo-built database retained, no service repointing/data wipe |
| Expanded catalog validity | PASS after name truncation repair; unique full object keys checked; logical visible-column order, not dropped physical slot numbers |
| Clone schema fidelity | **FAIL494** across3752source/3812clone objects; **0exceptions** accepted |
| Tables/columns/constraints/indexes/RLS flags/policies/sequences | Zero differences in these definition categories, not a full PASS |
| Public object grants | Zero differences; no production policy/grant changes |
| Remaining fidelity | 433grant entries,49function metadata,3extensions,4role memberships,3roles,2views |
| Data/Auth hashes/sequence values/storage bytes | NOT RUN, zero customer rows/objects copied; full Verification Standard remains P4 |
| Pending upgrades / P4 / P5 | NOT STARTED: blocked by failed fidelity gate |

[Export manifest](oracle-p3-cloud-export.json), [repair snapshot](oracle-p3-catalog-repair.json), [restore receipt](oracle-p3-clone-restore.json), [failed expanded gate with input hashes](oracle-p3-clone-gate.json), [all77 original differences](oracle-p3-drift-77.md) /[JSON](oracle-p3-drift-77.json).

## Original drift and security review

All77 original differences retained: RLS15 (including11policies), functions13, other49. Original subset did not inspect grants, so the grants group is explicitly uncovered, not a zero-difference claim. Every entry has cloud vs repo-built presence/value or exact definition MD5. Function plaintext stays private, not omitted from the hash comparison. Policy USING/WITH CHECK/roles/command are shown where present. All11 policy changes are conservatively security-flagged for possible cloud-stricter implications; logical implication of combined policies is not automatically proved. Preserve the source, never broaden it to satisfy the repo.

## Actual new blocker — grants/managed-object restore fidelity

Native pg_restore succeeded, but succeeded SQL is not equivalence.494differences include grantor/default-privilege/extension-role metadata, not494 proven permission escalations. A read-only local classification ignoring grantors found65additional effective grant keys (all for already-superuser supabase_admin) and8missing keys (USAGE on graphql/ graphql_public for anon/authenticated/postgres/service_role). Grant options/ownership still need exact review; no safety claim based on this classification. No unexplained difference was treated as an allowed platform exception.

Stop before further clone mutation, upgrades or data rehearsal. Proposed next repair is source-derived ownership/ACL/default-privilege/role reconciliation on the isolated target, with explicit per-object review and a new zero-difference check; **not executed**. Do not broaden IAM, temporarily grant new superuser authority, patch system catalogs, strip ACLs/owners from verification, or waive managed-schema differences. Baseline fresh-install zero-difference proof is **not achieved**, so baseline release stays disabled.

## Repair history and privacy

- Source export attempt1 incorrectly required pg_stat_ssl backendSSL=true behind the session pooler. The native client actually verified TLS/hostname; use verify-full+reviewed CA and native conninfo, not the pooler's backend leg. Attempt2 PASS; no TLS weakening/source write.
- Synthetic catalog SQL initially needed explicitchar->text cast. A later name-typed UNION truncated composite identifiers at63bytes. Explicittext+duplicate rejection repaired it; initial ambiguous map-based comparison is invalid, not a data mismatch or PASS. New test includes a long composite grant name and a dropped-column gap. Fresh v2 source catalog is a separate read-only snapshot; the original bound schema archive/catalog remain unchanged. Do not claim repaired catalog and original archive share a snapshot. Actual clone-vs-fresh-source comparison catches any intervening schema change.
- Expanded inputs are nonsecret metadata caches under ignored.cache/oracle-schema, hash-verified when moved. Reports record their SHA256. Raw schema/roles/catalog artifacts remain only protected VM.env paths; no row/password/function body/role-config value in public artifacts. Operational secrets remain as previously approved, Caddy exception unchanged.
- Native restore ran once in a new owned database; schema-only/transactional/exit-on-error, no--clean on an existing app/source database. No existing schema or customer data deleted. No IAM/paid resource/worker/update timer/provider/Vercel/source cloud/production DNS mutation. Existing Basic/noindex/SMTP sink/mock flags retained; no real application or outbound customer email.

Primary references: [PostgreSQL17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [Supabase platform restore guidance](https://supabase.com/docs/guides/self-hosting/restore-from-platform). Vendor baseline restore guidance does not replace this owner's stronger exact-grant/data checks. Current-source test/hosted results are recorded below after completion; older head CI is not reused as final-head proof.

Local verification: **940 Vitest tests/144files PASS**, **175 Linux helper tests PASS**, strict TypeScript/full zero-warning ESLint PASS. Tests include real disposable catalog execution, full composite identifiers, dropped-column logical order, grants/both policy predicates, duplicate-map rejection, no blanket exceptions and source TLS/read-only/redaction controls. No assertion/timeouts weakened. Final source/history/audit/whitespace and new-head CI are recorded separately after publishing; successful tests do not turn494differences into a PASS.

Source/history scan **855tracked files PASS**, dependency audit PASS with only the two existing owner-approved exceptions until29October. No new exception. Public cache inputs are explicitly ignored, not hidden secret exports. Documentation generator's trailing blank line repaired mechanically; no comparison result altered. Hosted final-head checks remain pending at handoff, not reported green from the prior head.
