# Oracle P3: protected ARM staging and explicit schema mismatch gate

## What and why

Stacked on P2 draft50; existing P3 draft51, **phase incomplete**. Pinned official slim Supabase ARM images/PG17.6 extensions, VM-only scoped secrets/static environment loader, private services/SMTP sink/Studio off, actual protected staging HTTPS. Repaired empty-target bootstrap, Kong prefix/config and stale env binds without data reset/cloud writes. All24 migrations+legacy baseline passed. Read-only definition-hash gate **FAIL295/361objects,77differences**, so migration stops before customer data/P4/P5.

## Risk

Cloud still records024, target includes025 plus older schema/policy differences. Never waive app differences as platform-only, weaken RLS, install025 into cloud, or manufacture PASS. Subset gate is early rejection only, not full P4 verification. Proposed exact-cloud-clone-before-upgrade sequence needs owner direction, not executed.

No new OCI/IAM/paid/production/provider/env/DNS/acceptance change, restore or employer submission. Old projects untouched; no YES CUTOVER. Caddy private state only approved path700/600/UID1002/backup-excluded. Secrets outside Docker Env/logs/argv/Git; private SSH/API/age keys not on VM. No production RLS/CSP change. Vite8.2.4 fixes GHSA-698v-4r3x-3vcv without new exceptions.

## Test plan

1. Run strict types/ESLint, full Vitest and Linux unittest discovery. Gate tests reject025/policy differences, duplicates/malformed input and promoted/incomplete target. Equality never claims full verification.
2. Inspect docs/evidence/oracle-p3-staging.md/schema-gate.json: expect **FAIL**,295source/361target/77differences, phaseComplete=false/P4/P5 unstarted. Source catalogs contain metadata/names/counts/hashes only, not rows/passwords/object paths/live function bodies.
3. Review runtime/DNS/TLS reports; never repeat PASS stages/reset counters. Owner-held staging credentials only: both unauthenticated hosts401/Basic/noindex with trusted TLS; authenticated app503 setup placeholder. No public DB/Studio. No Vercel preview deployment needed/authorised.
4. Realtime health is not event replication proof; no browser login/load/restore/app readiness claim. Later E2E uses anvesh.mannuru+ir35test@gmail.com/mock ATS only, never customers/employers. Production verification waits for later gates.

## Migrations / env / screenshots / manual steps

Existing repo migrations executed **on fresh Oracle staging only**, none changed. No customer data copied. Generated secrets stay/opt/ir35/.env*600/ir35; mock/acceptance=false/SMTP sink/Basic/noindex. Private Auth exports remain P7. No new public env value. No UI screenshot: app not deployed. Local/hosted checks recorded honestly in evidence.

Owner decision: resolve exact-cloud-baseline versus all-migrations ordering before P4. Existing DNS/Caddy approvals complete, no repeated password/DNS request. Human review only; never merge/approve/auto-merge/close PR or deploy production from CI.
