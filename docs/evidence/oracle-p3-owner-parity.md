# P3 owner decisions — schema parity PASS, 21 October 2026

This supersedes the historical FAIL4 hold only for the owner's exact staging repair. Source cloud, Vercel, production, DNS and customer rows were not changed. No cutover, merge, deployment flag, new resource or paid service.

| Gate | Actual result |
| --- | --- |
| CLI-role operational dependency audit | PASS:235 checks,9 components,197 host service definitions,0 active CLI logins/0 references. Migration runners use supabase_admin/postgres. |
| Expiry-only ALTER ROLE | PASS: all16 expiry fingerprints match the same cloud snapshot; other flags/config unchanged; no password change. |
| One direct-owner extension attempt | Completed once as non-superuser postgres in a clean isolated DB. Platform delegated all3 owners to supabase_admin. Transaction rolled back; only plpgsql remained. No second attempt/catalog update/privilege escalation. |
| a: platform/admin owners | PASS: postgres in cloud, supabase_admin on staging, never an app role. |
| b: every extension object ACL | PASS on both targets:62 objects, including4 type ACLs;55 extension members match. |
| c: app privileges and DDL capability | PASS on both targets:552 effective privilege entries/0 differences/0 broader;198 ownership/SET-role/schema-CREATE capability entries match. |
| d: exact versions | PASS: pg_stat_statements1.11,pgcrypto1.3,uuid-ossp1.1. All other extension records match too. |
| Final schema clone | PASS_WITH_OWNER_APPROVED_EXCEPTIONS:3752 objects each,0 unexplained differences, exactly3 owner-only exceptions. |
| Independent fresh-target baseline | Same PASS on ir35_baseline_proof_20261021; fresh empty DB, independent atomic restore, not a copy of the repaired target. |
| Customer data / full migration verification | NOT RUN: schema-only,0 customer rows imported. P4 counts/MD5/Auth/sequence/object-byte checks remain required. |

The only exceptions are extension:pg_stat_statements, extension:pgcrypto and extension:uuid-ossp. The comparison verifies every other field of these records is equal before accepting the owner-only difference. Each exception depends on a–d, the552-entry matrix and exact role expiry; no blanket platform exception. An unrelated grant, policy, function, role, type, version or missing object is FAIL.

Both isolated targets restored the hash-bound native schema archive WITH owners, ACLs and default privileges, --single-transaction/--exit-on-error. Supported ALTER FUNCTION/VIEW OWNER repaired51 members and exact original-grantor ACL replay repaired2 GraphQL schemas, identically on each install. No catalog writes, REASSIGN OWNED, app-role SUPERUSER or enduring elevated SET ROLE. Each target has one durable restore attempt; old failed targets/counters remain untouched.

Raw source bundle, archive, role definitions and full logs stay only under protected /opt/ir35/.env* paths (600,ir35). Public JSON contains names/counts/fingerprints only: [usage](oracle-p3-cli-role-usage.json), [one owner attempt/expiry](oracle-p3-owner-attempt.json), [both final gates/log hashes](oracle-p3-owner-fidelity.json). The source bundle is bound to the read-only snapshot at05:32:27Z; source/archive snapshots were checked for identical schema hashes, not falsely described as one atomic export. Temporary cloud CLI login expiry can rotate on later login; this proof compares the exact recorded snapshot.

Runtime boundary: protected services still use the original disposable postgres database, not either unattached clone. Do not point Auth at a schema-only clone: its migration-history rows arrive during P4. Existing TLS/Basic/noindex/SMTP sink/mock/acceptance=false/Studio-off guards remain. Full P3 service-on-clone integration and P4/P5 are not claimed from schema equality. Baseline52 may now expose the guarded schema installer, with cluster-role prerequisites and these exact exceptions; no normal migration-chain or production activation.

Verification:189 Linux helper tests PASS after adding compiled-installer and strict exception-rejection tests. Full current-source release/security checks and draft-head hosted status are recorded in progress.md after they finish. Tests never replace the native ARM comparison above.
