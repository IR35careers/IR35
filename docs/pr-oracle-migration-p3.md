# Oracle P3: private staging preparation — incomplete

## Current result

Owner approved narrow Caddy state exception and staging-only DNS. Added dual-resolver30min/CAA gate, ten native digest pins, slim official Compose adaptation, fresh VM-only secret preparation, compiled static per-service dotenv launcher (no private values in saved Docker Env), public Vault env-key hook, SMTP sink/private networks, Studio off-profile, and prepared staging-then-trusted HTTP-01 controls. **P3 remains incomplete**: DNS timeout/NXDOMAIN; no certificate requests. Postgres/sink healthy, first internal-up failed; six dependents stopped, full migrations/schema parity not run. [Detailed actual evidence](evidence/oracle-p3-staging.md) records errors/attempts/next repair,155 Linux units PASS. New source-only restart=no/header-file controls are not misreported as deployed PASS. No cloud rows/objects or production change. Owner next action only publish the approved staging records; no repeated key approval or private-value request.

## What and why

Stacked on P2 draft50. Verify the approved ARM Postgres digest and all five exact cloud extension versions, then prepare the slim internal Supabase stack on the existing staging VM. Added fixed helpers, durable attempt counters, collision/reuse guards, strict public input, scoped VM-only secret files and a native environment launcher. No source cloud connection, customer-data restore, new OCI resource or production change.

## Risk / current result

Native image and all five extension probes PASS; **P3 overall incomplete**. The isolated native probe uses a readonly rootfs, network none, no ports/host mounts and a3GiB/2CPU limit; its exited container is retained for reconciliation. The subsequent internal stack has healthy Postgres and SMTP sink only. Auth/Storage/Kong/Realtime startup failed and six dependents were stopped; no failed service is left in a restart loop. Missing empty-target bootstrap prerequisites still need repair before another guarded startup attempt. No schema/data parity or restore PASS is claimed.

Root administration uses the existing pinned owner channel; ir35 gains no sudo or Docker socket privilege. No production RLS/CSP/grant change. Vault basic view-read is not secret encryption/restore evidence. Both staging DNS names timed out NXDOMAIN at both public resolvers after30min; Caddy/Studio/worker have not started and no ACME request ran.

## Test plan

- Linux unittest discovery covers fixed inputs, resource/network/port boundaries, PG17 catalog query, log redaction, dotenv launcher file protections, DNS/CAA and exact empty-probe repair refusing real mounts/running/wrong-network containers.
- Vitest `tests/unit/oracle-image-pin.test.ts` checks exact source extension versions, native evidence/digest, zero customer data/ports, and phaseComplete=false; original readonly SQL guard retained.
- Review `docs/evidence/oracle-p3-native.md` /JSON and public attempt counts. No test invokes an employer or cloud-data write. Do not rerun an existing successful probe or reset counters.
- Actual local result:155 Linux units/four focused Vitest tests/strict TypeScript/scoped zero-warning ESLint/whitespace/source-history secret scan834files PASS. Hosted final-head CI remains separate.
- Full Compose fresh migrations/schema parity, protected staging E2E and test-account auth remain outstanding; no preview/UI screenshot applicable. Production verification only after later gates using anvesh.mannuru+ir35test@gmail.com, mock ATS only.

## Migrations / env / manual steps

No repository app migration executed. Fresh staging secrets were generated only on the VM in /opt/ir35/.env*600/ir35; no value was exported. Caddy's narrow private-state exception is approved and its data directory is empty700/ir35. Staging email is an internal sink; mock/acceptance=false flags are preserved. No live SMTP/Google/Supabase/Vercel/Stripe/DNS/billing change.

Owner action: publish/save only staging.ir35careers.com and api-staging.ir35careers.com A132.145.28.134 TTL300 (DNS-only if proxying is offered), leaving @/www/api/admin unchanged. The Caddy-key approval is already complete; no password or repeated approval is requested. Bootstrap repair remains agent work. Private Auth exports occur later in P7. Human review only; no merge/auto-merge/approval/PR closure/production CI deployment, and no YES CUTOVER received.
