# P6 — guarded mock worker / queue / Realtime / schedule integration

Owner released P6–P9 staging after actual P5 SDK PASS. P5 SDK7/7private +10/10singleedge/full containment; follow-up11read-only runtime checks/full containment;298helpers; all11hosted b114123checksPASS. P9prepare/dry-run only. All phases stay draft/unmerged, zero paid/production/provider/DNS/real-secret changes. Mock ATS/test account and SMTP sink only. Existing immutable journals/counters and no real-password attempts remain binding.

## First gate: read-only runtime/resource/security inventory

No new worker, queue, role, schema, timer, secret or container until prerequisite evidence is collected. Existing code on the P5 stack still rejects mock in queue worker configuration, and the separately drafted PR48 private-host validator is not integrated. Import that exact reviewed boundary, never use PG_BOSS_LOCAL_TEST to bypass it on Oracle or relax TLS/DNS protection.

Inspect real queue-role existence/least privilege/password-present booleans and queue schema/table inventory before deciding migration/install commands. Full schema verification includes cluster roles: do not silently create a role or grant that would violate exact parity and the three approved exceptions. Verified P4/reference/P5 databases remain unchanged; any functional fixture requires its own pre/post proof and disposable/write-journal boundary. Public auth/user data are never used to exercise real employer/email routes.

Resource inventory records existing container caps/states/ports/restart policies, actual VM MemAvailable/swap and data-volume usage. This is not a fresh OCI billing/Always Free resource-create audit; no new Oracle cloud resource is needed for this read-only step. Keep London2OCPU/12GB and150GB volume envelope, no fake load or updater/cutover enablement.

Planned gates (NOT yet claimed executed): queue role/schema ACL proof; real pg-boss mock queued/running/submitted-or-failed lifecycle + watchdog and visible errors; one Chromium; mock-only scheduled operations + durable heartbeat; correct Realtime tenant/Auth/RLS function; Compose/systemd restart and health; full62table/Auth/sequence/schema/552privilege/73object verification and retained rollback.
