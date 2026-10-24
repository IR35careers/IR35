# P6 — guarded mock worker / queue / Realtime / schedule integration

Owner released P6–P9 staging after actual P5 SDK PASS. P5 SDK7/7private +10/10singleedge/full containment; follow-up11read-only runtime checks/full containment;298helpers; all11hosted b114123checksPASS. P9prepare/dry-run only. All phases stay draft/unmerged, zero paid/production/provider/DNS/real-secret changes. Mock ATS/test account and SMTP sink only. Existing immutable journals/counters and no real-password attempts remain binding.

## First gate: read-only runtime/resource/security inventory

No new worker, queue, role, schema, timer, secret or container until prerequisite evidence is collected. Existing code on the P5 stack still rejects mock in queue worker configuration, and the separately drafted PR48 private-host validator is not integrated. Import that exact reviewed boundary, never use PG_BOSS_LOCAL_TEST to bypass it on Oracle or relax TLS/DNS protection.

Inspect real queue-role existence/least privilege/password-present booleans and queue schema/table inventory before deciding migration/install commands. Full schema verification includes cluster roles: do not silently create a role or grant that would violate exact parity and the three approved exceptions. Verified P4/reference/P5 databases remain unchanged; any functional fixture requires its own pre/post proof and disposable/write-journal boundary. Public auth/user data are never used to exercise real employer/email routes.

Resource inventory records existing container caps/states/ports/restart policies, actual VM MemAvailable/swap and data-volume usage. This is not a fresh OCI billing/Always Free resource-create audit; no new Oracle cloud resource is needed for this read-only step. Keep London2OCPU/12GB and150GB volume envelope, no fake load or updater/cutover enablement.

Planned gates (NOT yet claimed executed): queue role/schema ACL proof; real pg-boss mock queued/running/submitted-or-failed lifecycle + watchdog and visible errors; one Chromium; mock-only scheduled operations + durable heartbeat; correct Realtime tenant/Auth/RLS function; Compose/systemd restart and health; full62table/Auth/sequence/schema/552privilege/73object verification and retained rollback.

## Actual inventory / provisioning hold

[Read-only result](p6-inventory.json), seal `9fa0986a5f3f638758adbbe19e35f8dc7ae10b1495603f3ffd76a427a637d363`: diagnostic execution PASS, full pristine+app62table orderedMD5/two sequences/schema only3exceptions/552privileges/73Storage/manifests PASS. Both queue roles are absent (zero rows); existing `postgres.pgboss` ownerpostgres/tableCount0. This is NOT queue readiness or full P6 PASS. No role/grant/schema/password/queue/container/timer was created or changed.

Actual VM readings: MemTotal12,213,628KiB, MemAvailable9,113,744KiB (~8.69GiB), swap4,194,300KiB. Data mount105,089,261,568bytes, used1,114,009,600bytes, available102,884,732,928bytes (df2%). Existing containers have restart=no; worker is not deployed. Realtime exists but is not yet connected/validated for the P5 app clone. No new OCI billing/eligibility create claim.

**Owner decision required before queue provisioning:** creating two least-privilege roles on the primary cluster would be additional role objects, whereas current fidelity requires literal source-role equality with ONLY3extension-owner exceptions. Never silently ignore them or use a privileged existing login. Requested alternatives: explicitly approve the two queue-only staging roles as P6 operational additions with denied customer-schema access, OR preserve primary role equality using a separate small internal queue-only Postgres on the same VM (memory/backup envelope must be checked, no ports/no second VM). No architecture or parity-rule change assumed.

While provisioning is held, the exact PR48 `database-connection.ts` boundary from8b53e328 is prepared locally with direct, isolated regression tests. No production queue callsite/old assertion is changed yet; async integration remains pending, not falsely called deployed. It preserves Supabase verifiedTLS, exact allowlist + pinned privateDNS nonTLS, publicTLS requirements and password redaction. Preparation is safe regardless of the owner's role/isolation choice. No live worker or scheduler is enabled.

Offline validation PASS:47direct validator cases; full1014Vitest/154files;301Linux helper tests; strict TypeScript; zero-warning ESLint; public source/history scan1181tracked files before this final documentation update. Existing assertions/timeouts/role catalogs and source data unchanged. No third-failure retry/counter reset or additional live provisioning attempt.
