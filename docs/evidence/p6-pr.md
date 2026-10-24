## What and why

Owner-approved P6 staging continuation after P5 SDK gate PASS. This DRAFT currently provides an immutable read-only inventory/full fidelity gate, phase-specific context and the candidate PR48 host/TLS/DNS boundary with direct tests. It does not claim a deployed worker or complete P6.

Parent phase: draft #54 (`codex/oracle-migration-p5`), unmerged. No production deployment/merge/cutover authority.

## Current gates

- P5 SDK7/7private +10/10singleedge/full containment; current read-only runtime11/11/full containmentPASS. All11hosted b114123checksPASS; newer diagnostic heads have separate CI.
- P6 inventory9fa0986a5f3f: full62table orderedMD5/Auth/two sequences/schema only3approved owner exceptions/552privileges/73Storage/manifests PASSunchanged. Roles `ir35_queue` and `ir35_queue_producer` ABSENT; pgboss exists but empty/postgres-owned.
- Provisioning held for owner's explicit role-parity/isolation choice; no automatic exception, privileged fallback or new role/grant/secret/schema/queue/service/timer.
- Candidate exact PR48 validator prepared from8b53e328; direct47testsPASS. Existing queue callsites and old assertions unchanged; async integration/mock worker/lifecycle/Realtime/restart/scheduling/full phase signoff pending.
- Full local validation:1014Vitest/154files,301Linux helpers, strict TypeScript, zero-warning lint and source/history scanPASS. No UI/app behaviour is claimed from the unused candidate module alone.

## Test plan

1. Read docs/evidence/oracle-p6-staging.md and p6-inventory.json (names/counts/hashes/flags only).
2. Run `python -m unittest discover -s infra/oracle/tests` in Linux/WSL with existing isolated test dependencies.
3. Run `npm exec -- vitest run tests/unit/queue-database-boundary.test.ts`, `npm run typecheck`, `npm run lint`, `npm run security:source`.
4. No live test-account password or real employer/email operation is authorised. Future mock fixtures use only anvesh.mannuru+ir35test@gmail.com, isolated ATS and SMTP sink; credentials never in preview/Git/logs.
5. Do NOT replay any P5/SDK activation or the recorded P6 inventory; all journals are write-once. No preview touches production services.

## Risk / screenshots / migrations

Prepared code only, no changed production queue selection. New-role/queue deployment is deliberately not performed under literal role equality. Screenshots N/A (CLI/source-only gates). No database migrations executed or customer data changed.

## Environment and manual steps

`QUEUE_DB_ALLOWED_HOSTS` name/empty example only; no values/secrets copied. No Supabase/Vercel/DNS/Stripe/Postmark/Google/OCI-console/billing/real-secret changes. Owner must choose how P6 queue roles coexist with exact-role parity. P9 is prepare/dry-run only; exact YES CUTOVER remains absent. Keep draft/unmerged; no auto-merge or production publication.
