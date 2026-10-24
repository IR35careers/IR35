# P5 owner-approved SDK ordering repair (24 October)

Scope: draft PR54, config/observability only. New finite approval, NOT a reset of the previous three failed activation journals. No P6, production, cloud-Supabase, Vercel, DNS, Google, operational-secret change, paid resource or cutover authority.

## Private reproduction and repair

- Local WSL Docker29.1.3/x86_64, Caddy2.10.2 and Node22 pinned multiarch digests. New **internal-only** network; no published ports, existing network attachment, app/database/data/operational-secret mounts, Docker socket or log driver. Public synthetic fixture strings only. Both containers and network removed after each run.
- Frozen SDK negative fixture comes from pre-repair32066ca and is SHA256 `a7af757b2c5aff2e7429210e1fee364a4afb1b1485bbf86c03b3f493a48a149c`. Original exact guard/rewrite/proxy/fallback text retained. Stub echoes upstream route and rewritten path, no real requests/data.
- Reproduced **valid cookie404**: ordinary `handle` sorts its child directives, so terminal `respond404` precedes `reverse_proxy`. Missing/suffix cookies401 were correct. Fix: nest SDK children inside a literal `route`, preserving every auth/header/cookie/upstream-removal rule. [Caddy's documented ordering](https://caddyserver.com/docs/caddyfile/directives/route).
- Every request intent and result is O_EXCL/fsynced/read-only before caller assertions: method/path/expected/actual/matched route/all redacted response headers/real Caddy-generated UUID. Passwords, bearer tokens, cookie values and CSP nonces never enter public evidence.
- First private run reproduced the defect and returned all expected repaired statuses, but review found inaccurate default route labels on proxied responses. That evidence is retained, **not accepted as final signoff**. One bounded diagnostic repair moves labels into the exact guard/proxy/fallback branches; second run adds exact-route assertions and passes all7 cases. No third private run.
- One offline unit harness initially tried native Linux Git against a Windows-managed worktree and failed before Docker. Repair uses the frozen negative-fixture checksum, independent of shallow CI/Windows Git metadata. Full-suite literal-Basic-auth assertion initially detected diagnostics coupled into the generic generator; diagnostics are now isolated in the new approval's instrumenter. The existing assertion remains unchanged; no assertion/timeout/hash/catalog weakening.
- Final second-run seals: negative `11b17fb9078b35cd28430fdff7d9bec933614ae7eddd80801d7ab2733a2940bf`; repaired `61cff6c32f3ed398495d81cd1bd4696a2569cf9b6270d5635e6c34ba97310016`. Redacted adapted JSON diff `e413cd4447a47aaf266136a417dba16cb68df96e7e9d9d46433a087fa1b78dca` committed. Local full manifests cover Caddyfile too; public projection omits its synthetic bcrypt, with omission explicitly declared (not a public full-byte-manifest claim).

| Private case | Expected | Final actual |
|---|---:|---:|
| SDK missing cookie |401|401/sdk-guard|
| SDK suffix cookie |401|401/sdk-guard|
| SDK valid cookie / Auth health |200|200/sdk-proxy; rewritten path correct|
| Jobs / H1 / secure cookie |200|200/page-proxy|
| Maintenance POST |503|503/page-proxy|
| Basic rejection |401|401/basic-auth-rejection|
| SDK unsupported path |404|404/sdk-fallback|

All cases have noindex, exact no-store and actual Caddy UUIDs. Both configs validate and adapt. Public case records, intents, redacted adapted JSON and immutable hashes: `docs/evidence/p5-sdk-owner1/`.

## Staging activation and containment

**PASS — the single new activation was consumed; no replay authorised.** New controller refuses existing journal/root (including incomplete runs); old mutation controller stays held. Existing VM-only env and certificate directory reused unchanged. Original-compose rollback remains intact; no rollback was needed. ALL10 edge cases passed over trusted TLS, with real request UUIDs and per-case write-once evidence. Separate API Basic rejection401/Auth health200 also passed. The maintenance POST was refused503 before data writes.

Native prepare seal `11fdab674b57a759ab7084ce16650e4b053340a11a7bbf27fd9ad4192e3bb0d8`; edge seal `894c6408b8c47329106d0061666e728a0224d92e6cc7e8410944722d60ce616c`; post-containment seal `490c142636551da7a093791920b47b8562b65f1f4afb0501a1713fc9cbfe600b`. Native ARM Caddy validate/adapt passed; separately redacted native before/after JSON diff committed as `edge-01-prepare-adapted.diff`. Existing certificate dirs700/files600/ownerir35 preserved; no new/rotated operational secret or certificate-key copy.

| Gate | Result |
|---|---|
| Write-once cases/intents, route/header/Caddy UUID diagnostics |PASS|
| Private negative reproduction and final7case suite |PASS; two rounds, no third|
| Native ARM validate + adapt + redacted JSON diff |PASS|
| Single protected edge suite |10/10PASS; activationAttempts1|
| All previous P5, P4 snapshot and build manifests |PASS|
| Pristine + app DB ordered MD5/row counts |62/62each PASS; Auth included|
| Sequences |2/2each PASS|
| Full schema/security parity |PASS; only3already-approved extension-owner exceptions|
| App-role privilege parity |552/552each PASS|
| Original + app physical Storage byte SHA256 |73/73each PASS; original xattrs/locator set too|
| Private app services/no public ports; original rollback files |PASS/unchanged|
| Helper tests / source-history scan |295PASS /1167tracked files PASS including final evidence|

Public results: `edge-summary.json`, all10 `edge-02-edge-case-*.json` and intents, native redacted adapted JSON/diff, `edge-03-containment-table-fingerprints.json` (names/counts/ordered hashes only). Sealed native manifests also cover private full-fidelity reports and activation log; these are deliberately not represented as wholly public bundles. Local source/app/dependencies remain identical to verified builda35db40/imagecbc62c3a; no rebuild or application-code change in this repair.

No production/cloud-Supabase/Vercel/DNS/Google/provider/data/operational-secret/worker-acceptance/paid-resource/merge/cutover change. Staging remains Basic/IP/cookie protected, noindex/no-store, SMTP sink, mock/read-only/acceptancefalse. Earlier failures and counters remain unchanged. **STOP for owner review before P6.**

Health terminology: existing Auth SDK `/auth/v1/health` is the200 gate. Whole-stack `/api/health` truthfully stays503 while Realtime/worker are intentionally not configured; this repair cannot enable P6 or turn partial health into a fake200.

CI: `Private Caddy SDK ordering regression` on public-repository quality push/PR/manual triggers, contents-read only, pinned checkout, five-minute limit. Runs the real stub-only negative and positive Docker suite and verifies its evidence; no credentialed deployments or secrets. CI ephemeral tests do not authorise any staging activation.

Stop for owner review before P6, even if all gates PASS. Exact YES CUTOVER remains absent.
