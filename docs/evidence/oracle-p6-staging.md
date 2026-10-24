# P6 — guarded mock worker / queue / Realtime / schedule integration

## Native ARM image/browser PASS — no consumer enabled yet

[Build1](p6/worker-build-1.json), source1d21c10,346.658s, image68e887e8d9a5; actual ARM64/nonroot1002,Playwright1.61.0/pg-boss12.38.0; separate no-network/no-credential Chromium health PASS. Full before/after62table/2sequence/Auth/schema/552/73Storage/manifests PASS with two explicit minimal role additions. Image5,831,823,899bytes, no registry publication. Seal `d43a358991518953da47ca59cb86971c4b83ca708105a5c0b8aec5c8ddb0218a`. Startup/setup/lifecycle/Realtime/UI/schedules remain pending, not inferred from build success. No source/production/cutover change.

## Latest actual role gate PASS — worker still pending

[Two approved additions and unchanged552baseline](oracle-p6-queue-roles.md). Preflight54a353c1/install d3e50dd5 PASS: both TCP logins,6actual customer-read42501denials,354additional all-object privilege checks with0access, full62table/2sequence/Auth/schema/73Storage/manifests unchanged. Source roles untouched, raw baseline differences retained, exact TWO new queue-only roles recorded separately from3oldextension-owner exceptions. VM-only600/ir35credentials, no real acceptance. Earlier transport/role-choice holds below are preserved history and no longer pending.

Native ARM mock-worker build is now being prepared from committed source; no service has started. Isolated loopback browser child has no queue/HMAC/Supabase/provider/proxy environment. Real SQL tests cover atomic enqueue, duplicate/conflict/no-ack rollback, durable ordered states, explicit terminal failures, stale leases/watchdog and producer denials. Strong PR48 private-host validator is used by the NEW mock runtime; old production queue callsites remain unchanged for rollback, not falsely claimed migrated. P6/full UI/Realtime/timer/restart/native lifecycle gates remain open. Two local type-preparation errors (required NODE_ENV and tuple spread) were repaired without changing any assertions/timeouts; strict types and lint then PASS.

## Resume checkpoint — SSH transport owner gate, no VM change

Prepared role bootstrap/preflight, actual password/SQLSTATE42501 probes, all-object privilege matrices on operational/pristine/app databases, and a P6-specific fidelity adapter. It leaves the old comparator, raw catalogs,62table/2sequence/Auth/73Storage algorithms and552baseline untouched, classifying ONLY the two approved nonprivileged role additions separately. Native role install has NOT executed. The first read-only preflight was refused on the laptop before SSH (`KeySafetyError`); independent agent check reports keyLoaded=false after WSL restarted. No native stage, role, grant, password, service or timer was created.

All1048Vitest/155files and312Linuxhelpers PASS; new fourteenP6helper checks PASS; strict types/full lint/source/history PASS. The SSH launcher now retains an active WSL command with signal.pause after one existing-key hidden ssh-add, so Windows-only test runs do not idle-stop the RAM-only agent. Five focused agent tests (including this regression) PASS; no global WSL settings, key encryption or passphrase custody changed. Native hidden window opened; owner unlock is the only current handoff. Full P6 remains in progress, PR57draft/unmerged, P7–P9 still pending, exact YES CUTOVER absent.

## Latest owner decision / mandatory P5 SDK confirmation

**CONFIRMED before further provisioning:** [P5 sealed SDK evidence](p5-sdk-owner1/edge-summary.json) has sdk-missing401/PASS, sdk-suffix401/PASS, sdk-valid200/PASS; edge10/10PASS +containmentPASS, edge seal894c6408b8c47329106d0061666e728a0224d92e6cc7e8410944722d60ce616c. This is the actual newly approved switch, not inference from the earlier failures.

Owner now explicitly approved SAME Postgres with two minimal queue-only roles, VM-only credentials, denied-read tests for auth/public/storage, every source role unchanged, BOTH new roles listed as approvedP6additions separately from the untouched552baseline. The earlier choice hold below is historical, not a pending re-approval. No alternate queueDB will be deployed. Before actual role creation, test a P6 classifier that RETAINS raw catalog/baseline difference reports and identifies ONLY2exact nonprivileged new role objects; all other differences/source expiry/grants/memberships remain failures. No actual role/secret/queue/service change at this source-preparation checkpoint.

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
