# Oracle P3: native ARM Postgres compatibility — partial, owner-gated

## What and why

Stacked on P2 draft50. Pull/verify the exact approved ARM child digest and exercise all five exact cloud extension versions in an isolated empty Postgres17.6 container on the existing staging VM. Add fixed helper/driver, durable attempts, collision/reuse/known-empty-probe repair guards, strict public input and native evidence. No full Supabase deployment, source connection, data restore or production change.

## Risk / current result

Native image and all five extension probes PASS; **P3 overall incomplete**. Initial diagnostic GUC bug was classified and repaired, second empty probe PASS; no skipped checks/version substitution. Readonly rootfs, network none, no ports/host mounts, postgres UID,3GiB/2CPU limit. Existing exited probe retained for reconciliation, temporary data gone. Root-admin access is the existing pinned owner channel; ir35 gains no sudo or Docker socket privilege. No RLS/CSP/grant change. Vault basic view-read is not secret encryption/restore evidence.

## Test plan

- Linux unittest discovery covers fixed inputs, resource/network/port boundaries, PG17 catalog query, log redaction and exact empty-probe repair refusing real mounts/running/wrong-network containers.
- Vitest `tests/unit/oracle-image-pin.test.ts` checks exact source extension versions, native evidence/digest, zero customer data/ports, and phaseComplete=false; original readonly SQL guard retained.
- Review `docs/evidence/oracle-p3-native.md` /JSON and public attempt counts. No test invokes an employer or cloud-data write. Do not rerun an existing successful probe or reset counters.
- Actual local result:143 Linux units/four focused Vitest tests/strict TypeScript/whitespace PASS; final lint/source checks recorded in evidence. Hosted final-head CI remains separate.
- Full Compose fresh migrations/schema parity, protected staging E2E and test-account auth remain outstanding; no preview/UI screenshot applicable. Production verification only after later gates using anvesh.mannuru+ir35test@gmail.com, mock ATS only.

## Migrations / env / manual steps

No app migration executed, no env value/key generated or exported, no SMTP/Google/Supabase/Vercel/Stripe/DNS/billing change. Remaining owner batch: Caddy-only TLS/ACME private-state exception and staging-only DNS authorisation, exact steps in evidence. No production DNS or YES CUTOVER. Official slim Compose/image pins/fresh-target migrations follow that gate; private Auth exports later in P7. Human review only; no merge/auto-merge/approval/PR closure/production CI deployment.
