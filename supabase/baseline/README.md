# Cloud baseline — guarded staging schema installer

The owner's exact P3 repair now passes on both an isolated clone and an **independent fresh empty target**:3752objects each,0unexplained differences, exactly3conditionally approved extension-owner exceptions. See [native evidence](../../docs/evidence/oracle-p3-owner-fidelity.json) and [all gates](../../docs/evidence/oracle-p3-owner-parity.md). Historical FAIL494/FAIL4 evidence is retained, not relabelled.

The generated baseline is the native PG17 schema-only archive from read-only cloud, hash-bound in cloud-20261021.json. It stays private at /opt/ir35/.env.p3-source-schema.dump,600/ir35. No raw SQL/role-config values/passwords/customer rows are published. Existing migration history is unchanged; never concatenate/replay legacy migrations onto the cloud baseline.

## Execute/reconcile on the existing protected staging host only

```sh
python infra/oracle/cloud_baseline.py --staging-schema-only
```

Use the existing WSL interpreter/loaded SSH agent. No credentials in arguments. The wrapper validates both actual proof records before SSH, then the pinned-host installer verifies source/archive byte hashes, environment/mount/mock/disposable identity, private-file custody and durable state. It refuses missing/changed cluster-role prerequisites, nonempty/unowned destinations, failed/ambiguous attempts or production promotion. Existing RESTORED targets are read-back only, never restored twice. Secrets/private artifacts are not downloaded or printed.

The tested fresh install performs native transactional pg_restore WITH owners/ACL/default privileges and fail-fast logging, then the same supported51member-owner repairs/two exact-grantor GraphQL ACL replays on each target. No catalog patch, app-role SUPERUSER or lasting elevated SET ROLE. The one direct-owner extension experiment already completed/rolled back and is never retried.

Only pg_stat_statements,pgcrypto,uuid-ossp owner records may differ (cloud postgres/native supabase_admin). Exact versions,62ACL objects including4types,55members,198DDL capability entries,552app-role privilege entries and all16role-expiry fingerprints must independently match. Anything else fails. Reports have names/counts/hashes only; full logs remain protected VM.env files.

## Limits and next gates

This is **executable only for guarded staging schema preparation/reconciliation**, not a turnkey fresh-cluster bootstrap or production migration. Cluster roles must first have verified source-matching flags/configs/memberships/expiry and fresh staging-only passwords. The independent proof created a fresh database on that already role-aligned cluster, not a new OCI server. The historical raw archive and later catalog snapshot were independently hash-compared for schema identity; no false same-export-snapshot claim.

No customer data proof, session/login proof, pending-upgrade test or app rollout is implied. Existing services still point at the original disposable DB. P4 must restore data and migration-history rows before Auth attaches to the cloud clone, then prove counts/orderedMD5/sequences/Auth hashes/storageSHA256. Test pending upgrades only on a separate copy; never cloud. Production, Vercel, DNS, flags and cutover remain untouched. No install/deploy CI workflow or merge authority.
