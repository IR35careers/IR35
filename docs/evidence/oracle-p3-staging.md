# P3 Oracle staging —21 October 2026: schema FAIL, stopped

P1/P2 remain PASS. **P3 is incomplete**: actual schema comparison failed. No customer data imported, P4/P5 not started, no production/DNS/provider/env change or cutover. Existing draft [PR51](https://github.com/IR35careers/IR35/pull/51) remains for human review; never merged/approved/closed by the agent.

## Actual result

| Check | Result and limitation |
| --- | --- |
| Existing Always Free target | Same London A1,2OCPU/12GB,50GB boot+100GB data; no new resource/plan/ingress/IAM change |
| Native PG/extensions | PASS: pinned ARM PG17.6, all five exact source extension availability/load/basic-operation probes; [native evidence](oracle-p3-native.json) |
| Slim private runtime | Nine services running, eight backend healthchecks healthy after documented recovery; Studio off, Next/worker absent |
| Realtime | HTTP200/healthy=true on empty tenant; db_connected=false/replication_connected=false is not websocket/event replication proof |
| Scoped secret custody | VM-only.env files600/ir35; static loader keeps generated credentials out of saved Docker Env; no secret value exported |
| Env bind integrity | PASS: unchanged content preserves inode; existing containers rebound only where stale, current mounted inode/link identity verified |
| DNS/CAA | PASS after owner publication through1.1.1.1 and8.8.8.8; no incompatible CAA/AAAA observed; [DNS report](oracle-p3-dns.json) |
| HTTPS | PASS: actual Let's Encrypt staging HTTP-01 precedes trusted certificates on both staging hosts |
| Protection | Both external hosts401+Basic challenge+noindex with trusted TLS; authenticated app remains503 setup placeholder, protected Auth health200 |
| Caddy custody | /opt/ir35/data/caddy,UID1002,dirs700/files600; paths/permissions only exported, backup exclusion declared, no backup job yet |
| Email/worker | Internal SMTP sink, APPLY_RUNNER=mock/acceptance=false; no worker deployed or employer/email submission |
| Fresh-target app migrations | PASS: legacy waitlist prerequisite+all24 repository migrations in filename order, hashes/durable ledger; no public RLS-disabled table |
| Live source metadata | Read-only snapshot21Oct03:23:58UTC:PG17.6,62tables,123,980,947bytes,25policies,106functions,8triggers;024 recorded,025 absent |
| Actual P3 schema gate | **FAIL**:295 source/361 target objects,77 differences; no automatic exception or repair |
| Full zero-loss standard/data/objects/restore | NOT RUN; this subset rejection is not the P4 full verifier |

[Runtime/attempt report](oracle-p3-stack.json), [fresh source catalog](oracle-p3-source-catalog.json), [source schema hashes](oracle-p3-source-schema.json), [target schema hashes](oracle-p3-target-schema.json), [comparison](oracle-p3-schema-gate.json). Source reports contain schema names/counts/hashes, not customer rows, password hashes, object paths, live function/policy bodies or secret values.

## Decisive schema blocker

Identical read-only repeatable-read SQL hashes public columns/defaults/types, functions, policies, triggers and RLS flags in both databases. This is an **early rejection subset**; equality would be SUBSET_MATCH_ONLY, never full verification PASS. Constraints/indexes/grants/all app schemas/Auth/Storage/sequence/data/encoding checks still belong to P4's full standard.

- **71 target-only objects:** delivery lifecycle025 columns/functions/triggers, application_portal_sessions, billing_consents, billing_webhook_events, email_delivery_events and related columns/policies.
- **5 source-only objects:** add_to_waitlist(user_email text), waitlist policy Allow service role read, and the three Users manage own policies on application_events/application_packets/inbox_aliases.
- **1 changed definition:** claim_application_worker_task(p_worker_id text).

Cloud metadata still records024 only. Differences also include older migration/manual drift; do not attribute every difference solely to025. RLS enabled on both sides does not mean policies match. These are application objects, not a justified platform-only exception. No cloud DDL, source-row change, target policy weakening, skip/dedupe/truncate or import was performed to manufacture PASS.

**Stopped before P4/P5. Proposed owner decision, not executed:** use a distinct exact cloud-clone baseline for lossless schema/data verification, then a separately reviewed staging-only application upgrade with compatibility/reverse-sync tests. This changes the requested migration order and needs owner direction. Do not install025 into cloud or silently exempt these77 differences.

## Documented repairs and durable attempt history

1. Prepare lacked attached Docker stdin for Caddy hashing. Synthetic tests reproduced/refuted it; -i repair, attempt2 PASS; plaintext stdin only.
2. Initial private startup failed Auth42501/Storage authentication/Realtime missing bootstrap/Kong exit1. Original Compose caused implicit restarts (ten observed), then six dependents were stopped. Setup now uses restart=no. Counters/history retained, no hidden background loop.
3. Slimming out webhook setup also omitted supabase_functions_admin, interrupting99-roles and later platform SQL. On proven empty disposable target only, added the upstream role-only prerequisite and completed pinned platform files transactionally in order (CREATE DATABASE outside a transaction). No pg_net/webhook egress, reinitialisation, disk reset, new broad IAM or cloud mutation.
4. Kong tmpfs masked image libada under/usr/local/kong. Preserve libraries/use/run/kong; declarative file retains.json extension. Actual parse+nginx preflight PASS on attempt3. Internal-up attempt3 initially healthy; no fourth startup/preflight attempt.
5. Atomic replacement of unchanged env files unlinked active bind-mount inodes. Native launcher correctly refused nlink0. Fix/test preserves unchanged inode, then reconcile stale existing mounts once. That repair's final health failed on already exited Realtime; do not label the whole repair PASS.
6. Realtime exit1/non-OOM after DB restart independently diagnosed. Recovery attempt1 refused before starting due overstrict exit0 guard; tested narrow0/1 empty-target repair. Attempt2 started the existing container once, all-service/bind PASS. ERL_CRASH_DUMP_SECONDS=0/BYTES=0 and uploader=false prevent crash-secret persistence; no key rotation/recreation. Empty-tenant health limitations remain.
7. First app-migrations failed before DDL/ledger due stale env binding. Diagnosis proved Auth0/publictables0/empty ledger. After recovery, attempt2 applied baseline+24files using the existing postgres loopback rule, no HBA change. Public RLS enabled. Schema retrieval attempt1 PASS means retrieval only; comparison FAIL.

Durable counts include prepare2/internal-up3/kong-nginx-preflight3/runtime-audit3/realtime-recovery2/app-migrations2/schema-gate1. No reset, duplicate create, ambiguous replay or mutation after schema FAIL. The controller now refuses further VM operations locally whenever the comparison report is FAIL/incomplete; this guard is unit-tested before any credential/network access. Original30min NXDOMAIN timeout is history, superseded only by fresh dual-resolver PASS and certificate proofs.

## Verification and review

Tests cover actual static-launcher file/owner/mode/no-follow/duplicate/reserved-variable boundaries, redaction/no-secret argv/logs, unchanged inode, exact manifest/pins, empty-target migration refusals, read-only gate refusal/difference rejection. Durable errors are redacted; upstream public-image diagnostics are not customer function bodies. Sensitive backend Docker log drivers disabled; Caddy error logs rotated/access logs/admin/autosave off. Monitoring/retention remains later work.

Vite build-tool advisory [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) fixed by pin8.2.4; no new exception, existing braces/sprintf-js exceptions unchanged.

Current local checks: **935 Vitest tests/142files PASS**, **170 Linux units PASS**, **199 legacy checks PASS**, strict TypeScript/full zero-warning ESLint/dependency audit/whitespace PASS. **841-file source/history scan PASS**, including all newly staged metadata. No timeout/assertion weakened. Final-head hosted CI is separate, not inferred from an older head's9/10 result. Offline mocked OCI test CREATE/WAIT messages are fixtures, not live provisioning evidence.

No owner login, SSH passphrase or DNS action pending. Only schema-baseline/order direction blocks progress. No real-time billing-zero guarantee, load/RSS fit, browser login/provider match, zero-loss restore, app deployment, worker acceptance or production readiness claimed.
