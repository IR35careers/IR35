# P3 protected staging preparation — PARTIAL / DNS hold

20 October 2026. Existing draft [PR51](https://github.com/IR35careers/IR35/pull/51), stacked on P2 draft50; no merge/release. P3 is **not complete**, P4/P5 not started. Native PG17.6/five-extension proof remains PASS, not full stack/schema parity proof.

## Owner approvals and actual DNS result

Caddy-generated TLS/ACME state ONLY is approved under `/opt/ir35/data/caddy`, container UID1002, directories700/files600. Exclude it from backups unless age-encrypted. Other operational secrets stay `/opt/ir35/.env*`600 ownerir35. The [backup scope declaration](../../infra/oracle/staging-backup-scope.json) records the exclusion; no backup job/upload exists yet. No TLS key/certificate contents are exported.

Owner is adding only staging/api-staging A132.145.28.134 TTL300; no owner DNS write is inferred from approval. [Actual dual-resolver evidence](oracle-p3-dns.json): both names remained **NXDOMAIN** through dig@1.1.1.1 and@8.8.8.8 throughout the30-minute backoff window (final query completed at1801.336s). No restrictive effective CAA was found, but this is **not** DNS PASS. Watcher exited1 and stopped; it is not running indefinitely. Status was reconciled to TIMEOUT from that actual exit, not another network query. **Zero certificate requests, zero agent DNS writes.** Do not start Caddy or request either CA until a fresh dual-resolver/CAA check passes.

## Result table — do not infer PASS from configuration

| Check | Actual result |
| --- | --- |
| Native PG17.6 +five exact extension basic probes | PASS, previous native evidence |
| Service images | Ten ARM64 manifest/config digests verified; nine runtime images pulled, on-demand Studio not pulled/started |
| Official upstream | Pinned Supabase commit bc27d2661edd09a5d0b8d76ce33da6d4071a756e; official Kong override reviewed; four SQL-asset hashes in report |
| VM-only secrets / mock flags | Prepared600/ir35; APPLY_RUNNER=mock, acceptance=false; no worker exists yet |
| Secret custody hardening | Native static env launcher compiled; reads mounted600 files, execs without plaintext argv; independent Docker metadata check found no generated private values in saved Env |
| Persistent log safety | Sensitive service log drivers disabled; filtered in-RAM diagnostics only; Caddy error-log rotation prepared, no access logs |
| Private network | Backend internal-only, no DB/Kong/meta/SMTP/worker public ports; Studio off-profile/loopback-only declaration |
| Postgres / SMTP sink | Actual healthy, no customer data imported; auth.users count0 |
| First full internal startup | **FAIL**; Auth/Storage/Kong/Realtime failed; rest unhealthy; meta process healthy |
| Cleanup after failure | Six dependent services stopped; automatic restart loops stopped, no failed service left retrying |
| Fresh bootstrap metadata | auth/storage owned by supabase_admin, _realtime and _supabase absent; storage role has no password verifier. No password hashes exported |
| Caddy config validation / ACME staging / trusted certificates | NOT EXECUTED; DNS gate blocks issuance |
| Repo migrations / cloud schema parity / data rehearsal | NOT EXECUTED; no cloud-data read/write |

[Public stage report](oracle-p3-stack.json) retains prepare attempts2, launcher1, internal-up1 FAIL and diagnostic evidence. First prepare failed because Docker stdin was not attached to Caddy's hasher; synthetic no-stdin/attached-stdin tests reproduced/refuted it, fixed with `-i`, second prepare PASS. Plaintext was stdin-only, never argv/log/Git. The fresh OCI session refresh genuinely failed before preparation; owner completed one normal browser login, independently verified. No API/SSH passphrase repeated.

The initial Compose restart policy caused implicit background restarts (observed ten on failing services) before diagnosis; these were explicitly stopped. Next-run manifest uses restart=no during setup, not an unattended retry loop. This does not reset the durable command-attempt counters. Runtime restart policy can be enabled only after verified healthy staging, not by file presence. Realtime's next-run health request reads its header from a600 `.env.*` file rather than putting a token into curl argv; this fix is source-tested, not claimed deployed/healthy.

## Redacted failure evidence / next repair

- Auth: migration SQLSTATE42501 (insufficient privilege); fresh auth schema ownership requires reconciliation with official bootstrap.
- Storage: password-authentication failure for the fresh supabase_storage_admin role; its verifier is absent.
- Realtime: missing-object/migration class; fresh _realtime/_supabase scaffolding absent.
- Kong: exit1 referring to /usr/local/kong; exact prefix/config cause remains unproven, not guessed fixed.
- Loopback psql probes completed, but may use a trust rule: **not proof password authentication works**. No claim that those probes contradict the real service failures.

Next safe repair: inspect the pinned image's bootstrap ordering, explicitly reconcile the missing **empty disposable target** prerequisites/roles using reviewed upstream SQL, prove real network-role authentication and Kong prefix permissions with synthetic tests, then retry internal-up within its durable remaining budget. Never reinitialize/delete the data disk, overwrite real data, weaken RLS, change source cloud or manufacture parity. Ordered repo migrations/schema comparison follow only after internal services pass. No real-data comparison has been run or bypassed.

## Prepared controls, not executed claims

`staging-compose.yml` is generated from reviewed `staging_stack.py` plus digest pins: db3GiB, auth256MiB, rest256MiB, storage512MiB, kong384MiB, meta128MiB, realtime256MiB, Caddy128MiB; staging SMTP adds64MiB. Next/worker are absent. Studio512MiB profile is off. No 50-user/RSS fit claim. Public bindings are Caddy80/443 only, not currently listening.

The static launcher keeps actual values out of Docker's persisted Env and reads each component's scoped file in-process. The public Vault hook reads inherited key material rather than writing a separate root-key file. Caddy disables admin/autosave/access logs, app Basic/noindex, API owner/private-source gate preserving Bearer Authorization; no public Studio/meta/functions routes. ACME commands require fresh DNS/CAA proof, staging-only HTTP-01 first, trusted-CA issuance second; credentials are never sent through untrusted staging TLS. These are source-tested controls awaiting actual Caddy execution, not TLS PASS.

Local verification at this checkpoint: **155 Linux units PASS**, including a real compiled/static launcher, file-mode/symlink/duplicate/reserved-variable rejection, literal-not-shell interpretation, fixed DNS/CAA cases, exact manifest consistency and redaction. Four focused Vitest tests, strict TypeScript, scoped zero-warning ESLint, whitespace and source/history secret scan834files PASS; hosted final-head CI remains separate. Original product spec, production DNS/Vercel/Supabase/cloud data/providers, public-image publishing/update timers and live worker flags untouched. No paid service/resource created, no real-time billing-zero guarantee inferred.

Owner action, one batch: publish/save the two approved A records (DNS-only if the provider offers proxying), then confirm. @/www/api/admin remain unchanged. No new Caddy-key approval or password is requested. Other private bootstrap repairs are agent work, not a request for the owner to run SQL.
