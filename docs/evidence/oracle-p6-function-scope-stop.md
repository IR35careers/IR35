# P6 effective function-scope gate — STOP, 25 October 2026

The queue-role audit found effective access outside the approved queue scope. This is **not** a claim that CVs were read or that a source-data comparison failed. No application function was called.

| Check | Actual result |
| --- | --- |
| Operational `postgres` | 22 role/function metadata checks; zero accessible non-queue SECURITY DEFINER paths |
| Verified pristine application copy | 6 checks; both queue roles can execute `public.add_to_waitlist(user_email text)` |
| P5 application copy | Same two accessible paths |
| Function | Returns `json`; also accessible to `anon`; definition MD5 `7da948329581a94025fe8e9887f7b8b2`, matching the unchanged cloud snapshot |
| Audit actions | Catalog/privilege SELECTs only; zero application-function calls or data/grant writes |
| Deployment actions | New worker starts 0; no service, HBA, IAM, network, bucket, credential, production or DNS change |
| Full post-containment | PASS: 62 counts/ordered MD5/Auth hash parity, 2 sequences, only 3 approved schema-owner exceptions plus 2 named queue roles, unchanged 552 privileges, 73 Storage SHA256 |
| Existing table/column denials | Remain valid; do not establish function isolation |
| Source gates | 385 Linux helpers; 1,069 unit tests; 199 legacy checks; strict types/lint/dependency audit/source-history PASS |

[Full write-once result](p6/mock-runtime-update-two.json), SHA256 `37603a21d7f0cbced837f7c608b1651e8125bfefab3584564a4fe6e751281330`.
The old image/environment/proxy are unchanged and were health-checked before the audit. [Image 2](p6/worker-build-2.json) is built and retained, **not activated**. The one approved Bastion session was already closed; no additional session is authorised or needed.

## Why individual REVOKE is not a fix

PostgreSQL privileges are additive: a role can retain access through PUBLIC even when it has no direct grant. Revoking only from the queue roles would not remove a PUBLIC grant. Changing the source-derived PUBLIC ACL would violate the exact-clone/unchanged-customer-permissions gate. [PostgreSQL REVOKE documentation](https://www.postgresql.org/docs/17/sql-revoke.html).

## Owner decision needed — nothing below executed

1. Recommended: narrow **staging PostgreSQL client-authentication** rules allowing only these two roles to connect to the existing operational queue database `postgres`, rejecting their connections to every application/clone database, including local/IPv4/IPv6 paths as applicable. No new database, VM, OCI resource, public network rule, role/password or customer ACL change. Keep future customer restores in a separate application database, not the queue database. Preserve the raw function-access finding and the unchanged 552 baseline; require actual password-authenticated denied-connection tests plus all existing table/schema/data/Storage checks. [PostgreSQL client-authentication rule documentation](https://www.postgresql.org/docs/17/auth-pg-hba-conf.html).
2. Alternatively, approve a read-only private definition/ACL review first. Do not invoke the function or silently add an exception because it is already public.

Any connection-boundary repair needs explicit owner approval. Do not reset/replay stage09, alter hashes/catalogs/assertions, revoke PUBLIC privileges, move customer rows, change secrets, or advance P7/P8/P9 under this stopped attempt. All PRs stay draft/unmerged. Production and the old cloud stack remain untouched; `YES CUTOVER` is absent.
