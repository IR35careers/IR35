# Oracle P3 — native compatibility PASS; full phase at owner gate

20 October 2026. Stacked on P2 draft [#50](https://github.com/IR35careers/IR35/pull/50); no merge or production deployment. [Machine-readable evidence](oracle-p3-native.json) deliberately has **phaseComplete=false**.

| Check | Actual result |
| --- | --- |
| Existing hardened target/approved network prerequisites | PASS; unchanged London A1 2OCPU/12GB/150GB, no new OCI resource |
| Pinned native image pull | PASS; linux/arm64, exact child digest, 1,746,666,817 image bytes;35.499s |
| Postgres | 17.6 /170006, UTF8, disposable C.UTF-8 DB |
| pg_stat_statements1.11 | Available, exact-version load, statistics-view read PASS |
| pgcrypto1.3 | Available, exact-version load, known SHA256 digest operation PASS |
| plpgsql1.0 | Installed exact version, DO/exception/control-flow operation PASS |
| supabase_vault0.3.1 | Available, exact-version load, empty decrypted-view read PASS |
| uuid-ossp1.1 | Available, exact-version load, UUID generation PASS |
| Probe isolation | network=none, no published ports/host mounts, readonly rootfs, postgres user, 3GiB/2CPU/256PID limit,512MiB disposable tmpfs |
| Source data / credentials / DNS / production | None read/copied/changed |
| Full official Compose setup/migrations/schema parity | NOT RUN; P3 incomplete |

Image: `supabase/postgres:17.6.1.136@sha256:a9946f08d31e8eb1149229c94e5c26603a9233116807cbbd93d75179cbac516a`. Executed natively on the existing VM, not emulation. Docker image cache remains on the verified data volume. The probe is exited; temporary DB contents disappear with tmpfs, no real data was used. Vault evidence is loading/basic view access, **not** an encrypted customer-secret restore or key-custody proof.

## Diagnosed self-heal, no hidden retry

First probe exited3 because our diagnostic used removed configuration parameter `lc_collate`. The log reader initially inspected only stdout, while Docker replays this error on stderr; its second read classified the error without printing logs. Replaced that single diagnostic with `pg_database.datcollate`, added tests, and recreated **only** the exact labelled/exited3/readonly/no-network/no-mount empty probe after independently recognizing that exact error. Second probe PASS in1.414s. No database volume touched, no extension version substituted, no cloud source altered. Durable attempts remain pull1/probe2/diagnose2. The source-discovery and repair fixtures use public synthetic SQL only.

## Batched owner gate before HTTPS staging

1. Approve the narrowly scoped exception for **Caddy-generated ACME account and TLS certificate private keys only** in persistent `/opt/ir35/data/caddy`, owner ir35, directories700/files600, no public/Studio access or log exposure. Caddy must keep this state to renew/reuse certificates; the current env-only secret rule does not yet permit it. SSH/API/age private keys remain off-VM; application secrets remain `/opt/ir35/.env*`600. No certificate key has been generated here.
2. Approve staging-only DNS preparation: A `staging.ir35careers.com` and A `api-staging.ir35careers.com` → `132.145.28.134`, TTL300. **Do not change @,www,api,admin or existing production records.** App will use Basic auth/noindex; API must preserve Bearer Authorization and remain restricted to the approved owner/private access path, not use conflicting HTTP Basic on the same header. Records/HTTPS activation wait for this gate; no DNS write performed. Exact safe API proxy/access tests precede any real-data rehearsal.

After the gate, finish pinned official slim Compose (including Kong override/Realtime, Studio off-profile), fresh VM-only secrets, fresh-target ordered migrations/schema diff, then P4. Private Auth exports and Google changes are later batched P7 gates, not requests to paste anything now. No P4/P5 result claimed and no production cutover authorised.

Sources: [Supabase official self-hosting](https://supabase.com/docs/guides/self-hosting/docker), [PG17 guide](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17), [PostgreSQL17 database catalog](https://www.postgresql.org/docs/17/catalog-pg-database.html), [Caddy automatic HTTPS/storage requirements](https://caddyserver.com/docs/automatic-https). These describe interfaces, not a substitute for the actual native evidence above.

Local checks: **143 Linux units, four focused Vitest tests, strict TypeScript, scoped zero-warning ESLint, whitespace and source/history secret check (819 tracked files) PASS**. Hosted final-head P3 CI is separate. P2 PR50 has all ten checks SUCCESS at5185a6c, still OPEN/DRAFT/unmerged. No actual cloud-data/schema equality, login, backup restore or load result is inferred.
