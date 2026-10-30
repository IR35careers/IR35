# Oracle cutover runbook — DRAFT / NO-GO / PREPARATION ONLY

Owner: IR35careers. Executor: Codex only inside the owner's later approved change manifest. Region `uk-london-1`; Oracle profile `ir35`/SecurityToken. Existing A1 public IP `132.145.28.134`. No DNS, provider, production environment, old-stack data or cutover action has been executed by preparing this document. Exact **YES CUTOVER** is absent. Never merge a PR or remove the old projects yourself.

**30 October current status: NO-GO.** The two actual staging HEAD checks returned401 with both `Cache-Control: no-store` and `X-Robots-Tag: noindex`. Therefore no Caddy activation is needed or authorised: no edit, reload or restart occurred. The backup-IAM controller had two retained failures; its third execution stopped before **any mutation**. The subsequent read-only IAM audit proves unchanged IAM. Do not start a fourth native attempt, install a backup timer, upload a backup, or infer permission from offline tests. No real backup restore, native reverse-sync, writable QA, monitoring activation or end-to-end P9 rehearsal has passed. All phase PRs remain draft/unmerged; production and the old rollback stack remain untouched.

## 1. Release status and absolute gates

| Required proof | Current evidence | Release state |
| --- | --- | --- |
| P1–P6 protected infrastructure/app/mock worker | Existing phase drafts49–54/57, P5SDK401/401/200, P6 full152checks/Realtime/schedules/restart | Historical PASS, revalidate current build/config before release |
| P7 source-configured Auth/Storage | Draft61, Auth03 + Storage73/73 + full containment | Staging API PASS; no real Google/SMTP proof |
|50-user load | Draft62/read-load02:200GET/0errors/p95=3883.508ms,>=2GiBOS headroom | Scoped read-load PASS, NOT full browser/write QA |
| Protected real-browser read paths | P8 headed browser01:5pages/148stagingGETall200/13externalGETsblocked, full containment | Read-only browser PASS, NOT authenticated write/provider proof |
| Application schema/runtime compatibility | P8 snapshot inventory:025's10columns/10functions absent; source queue wiring fixed/CI verified, not deployed | **BLOCKED** until separately owned upgraded-clone QA and immutable runtime proof |
| Encrypted automated DB/globals/queue/Storage backup and full restore | Local age custody/round trip PASS; owner approves the exact regional lifecycle service scope, but two controller failures and a stopped third execution made zero IAM/lifecycle/VM changes. No VM recipient/timer/upload/restore signoff | **BLOCKED**; no fourth native attempt or broader IAM inferred |
| Oracle→cloud reverse migration including insert/update/delete, sequences, Auth and Storage | New P8 script/helper/tests are source-only and disposable-target-only; no native reverse run, managed-cloud Storage reversal or queue-data reversal is proven | **BLOCKED**; no production rollback mode |
| Full browser signup/login/recovery/search/detail/save/mock-apply/account/dashboard | API Auth proven separately; read-only P5 fixture cannot prove writes | **BLOCKED** until isolated writable QA fixture and full browser suite |
| Current Always Free usage/cost/backup request reconciliation; monitoring/disk alerts |30Oct audit:ACTIVE FREE_TRIAL/A1LIMITED_FREE2OCPU12GB,150GBlive,0volume backups,exactStandard0bytes including versions/multipart,quota3match; real-time£0notproven/laggingGBP0 insufficient;0alarms. Unattended capacity observer needs the uncreated three-permission VM policy | Usage audit PASS at its recorded time; capacity observer/request budget/monitoring/delivery still **BLOCKED** |
| All-writer source freeze, final-copy timing and reverse timing | Source-provider capability and end-to-end drills unproven | **BLOCKED** |
| Human PR reviews/merges and immutable release build | All phase PRs remain draft/unmerged | **BLOCKED** |
| Owner DNS/Google actions and exact YES CUTOVER | Not done; only staging DNS previously authorised | **BLOCKED** |

**Historical 27–28 October checkpoint, retained verbatim:**

No release while ANY row is blocked. A dry-run plan, green unit tests, decrypt/list-only test or a valid hash manifest does not prove restore, reverse-sync or freeze. P9's real staging dry-run is NOT complete. `scripts/migrate-db.sh` currently refuses production execution; `scripts/reverse-sync.sh` is absent. Do not paste invented executable commands in their place. Completing/testing both controllers is a go/no-go prerequisite, not an optional manual step.

**Current file status, 30 October:** a new `scripts/reverse-sync.sh` now exists in the separate P8 working tree, with guarded Python helpers and24 offline tests. Its default is side-effect-free `--dry-run`; its only execution mode is an exactly named, newly owned disposable staging rehearsal. Source code prepares actual synthetic insert/update/delete plus an explicit hashed deletion ledger, full62-table comparison and original-baseline re-verification after fixture removal. None of those native operations has run. Do not interpret either the historical absence statement or the new offline tests as a claim of native zero-delta/nonempty-delta success, production execution support, managed-cloud Storage compatibility or queue-data reverse proof. P9's real staging dry-run is NOT complete, and production rollback remains non-executable.

Latest immutable P8 references: [read-only browser proof](https://github.com/IR35careers/IR35/blob/d1c1c0b/docs/evidence/oracle-p8-browser-readonly-20261027.md), [snapshot capability/full containment proof](https://github.com/IR35careers/IR35/blob/d1c1c0b/docs/evidence/oracle-p8-app-readiness-20261027.md), [hosted source gates](https://github.com/IR35careers/IR35/blob/d1c1c0b/docs/evidence/oracle-p8-runtime-hosted-20261027.json). ALL11hosted checks passed on exact source6c3c372, including repaired CodeQL and nativeARM/AMD64 queue standby; this does not claim later evidence heads passed before observed, or that normal queue source/OAuth fixes were deployed on Oracle. Snapshot inventory seal3795578c proves all original data/security checks unchanged, not save/apply compatibility. No025 migration on pristine/P5/cloud. Pending upgrades require a separate disposable copy and before/after deltas, followed by unchanged original containment.

### 1a. Latest 30 October evidence — recorded holds, not new execution

The following are write-once artifacts in the P8 worktree; publication to draft62 must be verified separately. Their manifest hashes bind the recorded results, not a claim of later release readiness.

| Artifact / manifest SHA-256 | Recorded result |
| --- | --- |
| `docs/evidence/p8/caddy-head-owner-20261030-01/`; `cd979540e5b55cc6992d14b335c88f846b95a1dd111e6741db058ec96cfe5951` | Two real unauthenticated HEADs PASS401/no-store/noindex. No activation; a broader actual GET audit remains separate. |
| `backup-iam-owner-20261030-01/`; `57dcca1709f36f8dbe66c3c6e43b10d400a0d0be475487dab5097852149aba71` | FAIL `OneAuthenticatedBackupBucketRequired`: bucket metadata used a separate transport and was missing from the controller projection, not evidence of a missing bucket. Zero mutations. |
| `backup-iam-owner-20261030-repair01/`; `b052398f71610c2323542cc275f8b6d82260709d349725f1b03417e0fae4816d` | FAIL `BackupScopeError`/`RawErrorWithheld`; later read-only diagnosis found the CLI bucket GET omitted optional autoTiering. No relaxed Disabled/null assertions and zero mutations. |
| `backup-iam-owner-20261030-repair02/`; `f9e2efadc36c0bc7ae68464fc91927a593de0c57ae648c5fcae90123f89b72b1` | Third controller stopped before any mutation. No fourth native attempt; preserve the previous failures and counters. |
| `iam-hold-readback-20261030-01/`; `f1c170874f114edcbd8af4cc145a6edc7d84f39f7d20806c556003da2f5cfbbf` | Read-only PASS:3 metadata reads,0 dynamic groups,1 existing root policy,0 child policies; IAM before/after unchanged. No lifecycle, VM, bucket or production change. |
| `lifecycle-cli-shape-diagnosis-20261030-01/`; `13f617824baff855a86c85c7d75b981e1f0c3f0d68c4069c37727ad6ff60b0db` | Offline `DIAGNOSED_NOT_REPAIRED`: CLI serializes camelCase SDK fields to kebab-case plus explicit null filter fields, so the current strict equality would fail. It also prompts without explicit confirmation and supports the missing create-only precondition. No controller repair, assertion change or native call. |

Security source change is narrowly limited to the original two withdrawn GitHub advisories: `GHSA-vfj7-8cjw-p6xm` (braces) and `GHSA-hp3w-g68c-fv3c` (sprintf-js), renewed only until `2026-11-30T00:00:00Z` with the withdrawn-advisory reason/provenance. No other exception, workflow, dependency, backdate or release bypass is authorised. This source reconciliation does not substitute for observing current CI.

The capacity observer remains independently blocked: creating the proposed VM-only `OBJECT_CREATE`/`OBJECT_INSPECT`/`OBJECT_READ` writer policy would NOT supply bucket metadata, bucket discovery, unfinished-upload, shared-usage or monthly-request evidence. Two additional bucket-read permissions alone would not prove all those sources either. Review a separate narrowly scoped read-only observation design before any extra IAM; never treat denied/stale/absent data as zero/fresh evidence or relax the current guard. The approved lifecycle service principal is separate: bucket inspection in compartment ir35 and read/inspect/delete only for `ir35-backups`, with no VM delete permission or tenancy-wide expansion. Approval is not a record of creation. No backup timer, encrypted upload, actual restore, reverse native run, monitoring/alarms or writable native QA is proven by these diagnostics.

## 2. Owner-only action batch, before a release date is scheduled

1. Oracle sign-in was completed and independently verified on30October; it is NOT another action requested now. [Current recorded usage audit](https://github.com/IR35careers/IR35/blob/ece46358ca2bdd5fc12f247a66cb826c1b6ce82c/docs/evidence/oracle-p8-owner-resume-20261030.md) proves ACTIVE FREE_TRIAL/London/LIMITED_FREE2OCPU12GB/150GBlive/0volume backups/exactStandard0bytes/rootquota3statements at its timestamp, not real-time billing£0 or future eligibility. Before actual resource work recheck usage/token and monthly request budget. Refresh once below10min; only failed refresh/daily limit needs another browser handoff. Fingerprint-check the existing no-lifetime SSH agent first, never prompt just because time passed. No trial-credit or PAYG spending.
2. The owner-approved ACL repair and ONE actual age ceremony already PASS; do NOT regenerate or request another key choice. Private identity is owner-only outside Git at `C:\Users\anves\.oci\ir35-p0-readonly\oracle-backups-age.identity`, never on the VM/in chat; store an offline copy of the age key file in your password manager or on a USB drive. Transfer ONLY the public recipient after the remaining backup gate passes. The exact regional lifecycle service scope is now owner-approved, but no group/policy/lifecycle/upload was created: the third controller stopped before mutation and read-only IAM read-back matches the original. Do not ask for the same approval again or run a fourth native attempt under the exhausted gate. Report the known CLI serialization, confirmation and create-only-precondition defects for owner review; they are diagnosed, not repaired. The VM policy remains only CREATE/INSPECT/READ, not DELETE. Never broaden IAM or use an API key/PAR/multipart workaround. The two actual live staging HEADs already PASS401/no-store/noindex, so no Caddy activation is required or authorised now.
3. Review the exact [Google entries](oracle-oauth-redirect-plan.md). The owner makes Console changes. Keep current cloud callback during rollback retention. Preserve GIS hashed nonce and flag-protected redirect fallback. The existing deployed image still canonicalises non-admin production-mode origins to www. [PR61 source fix](https://github.com/IR35careers/IR35/pull/61), commit0fa0d51, accepts only an explicitly enabled exact HTTPS staging origin and fails closed otherwise;50Google-related tests and1083unit/199legacy/release checks PASS. It is NOT in the deployed Oracle image: a new verified protected fixture/browser proof is still required before real provider activation. No production flag/provider change is implied.
4. Transfer any later authorised real SMTP/provider credentials directly to VM-only `.env*`600/ir35 and the password manager; no preview, Git, stdout or chat. Staging remains on SMTP sink. Real mailbox delivery tests need explicit owner scope; current order prohibits them.
5. Review existing DNS records/CAA and schedule TTL and final switch separately. The record sheet below is a PROPOSAL, not permission to execute DNS changes. The owner records current complete RRsets for lossless restoration.
6. After every staging gate passes and human review is complete, the owner must type exactly **YES CUTOVER**. “Yes”, “go”, “ok”, an issue comment or an automated goal continuation is NOT the gate. Any later scope conflict still stops execution.

## 3. DNS and TLS record sheet — owner executes G5 only

At least24h before maintenance, owner lowers existing `@`, `www`, `api` AND `admin` TTL to300 and waits out the **previous** TTL. Save RR types/targets/TTLs,including A/AAAA/CNAME/alias and provider proxy settings, before changing anything. Do not leave a competing CNAME or old AAAA sending clients to another writer.

After final verification PASS and explicit cutover/G5 authority, proposed destination:

| Name | Type | Target | TTL |
| --- | --- | --- | ---: |
| `@` | A |132.145.28.134|300|
| `www` | A |132.145.28.134|300|
| `api` | A |132.145.28.134|300|
| `admin` | A |132.145.28.134|300|

`staging` and `api-staging` are the already authorised separate staging records, not production aliases. Read back against1.1.1.1 and8.8.8.8; verify CAA permits `letsencrypt.org`. Do not silently edit CAA. Any stale/conflicting record or unapproved certificate request is NO-GO.

Caddy alone binds80/443. Customer canonical origin is `https://www.ir35careers.com`; bare redirects HTTPS308. `api` proxies Kong preserving `/auth/v1`, `/rest/v1`, `/storage/v1`, `/realtime/v1` semantics. `admin` proxies the SAME Next app with its actual Host header: current `src/proxy.ts` maps `/`→`/admin`, `/login`→`/admin/login`, while public host `/api/admin` remains404. Do not redirect admin users into public customer auth. Prove admin session isolation in browser before release.

First test ACME with staging issuer and non-public/synthetic hosts under the owner's staging authority. Production certificate issuance for four live hosts needs the reviewed DNS/challenge plan. Caddy private state remains only `/opt/ir35/data/caddy`, container-owned,dirs700/files600, excluded from backups. Existing Basic auth/noindex/no-store guards remain on staging; **never** remove them to let a test pass. DB5432/Kong8000/Studio remain private, SSH restricted to owner/Bastion /32s only.

## 4. Immutable release and secrets checklist — names only

- Build reviewed, human-merged source into digest-pinned linux/arm64 images. Record app/worker/Postgres/Auth/Storage/Kong/Realtime/Caddy digests and source SHAs. Existing P5/P6 test images are not automatically the final production release. No production Git deployment/update timer is enabled by this runbook.
- App names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_INTERNAL_URL`, `SUPABASE_SECRET_KEY`, `IR35CAREERS_APP_URL`, `IR35_WEB_HOST`, `IR35_BUILD_SHA`, `IR35_STAGING`, `IR35_READ_ONLY`, `IR35_SESSION_MIGRATED`, `IR35_WORKER_HEALTH_ENABLED`, `IR35_REALTIME_HEALTH_ENABLED`, `IR35_PUBLIC_HTML_CACHE`.
- Queue/schedules: `APPLY_RUNNER`, `APPLICATION_WORKER_ACCEPT_JOBS`, `APPLICATION_WORKER_SECRET`, `APPLICATION_WORKER_CONCURRENCY`, `PG_BOSS_DATABASE_URL`, `PG_BOSS_PRODUCER_DATABASE_URL`, `QUEUE_DB_ALLOWED_HOSTS`, `PG_BOSS_SSL_CA`, `IR35_SCHEDULER_ENABLED`, `CRON_SECRET`. Minimal queue roles, exact-host validator, correct private/TLS boundary and HBA denials remain.
- Auth/provider names: `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `GOTRUE_SITE_URL`, `API_EXTERNAL_URL`, `GOTRUE_URI_ALLOW_LIST`, `GOTRUE_EXTERNAL_EMAIL_ENABLED`, `GOTRUE_SMTP_HOST`, `GOTRUE_SMTP_PORT`, `GOTRUE_SMTP_USER`, `GOTRUE_SMTP_PASS`, `GOTRUE_SMTP_ADMIN_EMAIL`, `GOTRUE_SMTP_SENDER_NAME`, `GOTRUE_EXTERNAL_GOOGLE_ENABLED`, `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID`, `GOTRUE_EXTERNAL_GOOGLE_SECRET`, `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_REDIRECT_FALLBACK_ENABLED`; all mapped templates/rate/security/session controls in the private G3 export. Do not infer missing values/defaults or copy production secrets to previews.
- Generate/hold fresh Oracle signing values only in VM `.env*`600/ir35 plus password manager. Staging sink remains separate. Show **“Please sign in again”** after migration. Preserve user password hashes/identities, no password resets. Explicitly rehearse restored-session invalidation without silently deleting rows before the zero-loss comparison.
- Worker remains `APPLY_RUNNER=mock`, real acceptancefalse, one Chromium. Cutover does **not** authorise real runner activation. Production apply/auto-apply controls must clearly reject/hold real submissions while acceptance isfalse; never show mock receipts as real submitted applications. Only named test-account/mock ATS payloads may run.
- Provider secrets/external SMTP are still external services, but no production Next/Auth/Storage/queue/cron path may depend on Vercel or Supabase cloud after the eventual approved switch. Search release client bundles/server env/queues/callbacks for unintended cloud endpoints; the retained rollback callback itself is not a runtime dependency.

### 4a. PostgreSQL 17.11 readiness — checklist only, not an upgrade

Owner requested this P9 preparation item on28October. The [minor-update plan](oracle-postgres-minor-upgrade-plan.md) records the existing17.6 pin, primary release/compatibility sources and the separate staging rehearsal/rollback gates. No17.11 image has been selected or pulled and no database update has occurred. These boxes remain unchecked; all other NO-GO gates still apply.

- [ ] PostgreSQL 17.11 readiness (current recorded staging: 17.6): exact official Supabase ARM64 package/source/digest selected and independently attested as server_version_num 170011; no floating tag, OrioleDB/x86 substitution, or pg_upgrade.
- [ ] Separate owned staging minor-update + rollback rehearsal PASS; cumulative 17.7–17.11 notes reviewed, required extensions/versions/plugins/collations and pinned Auth/Storage/Realtime compatibility proven. Applicable data cleanup or new drift remains NO-GO, not an implicit exception.
- [ ] Age-encrypted full DB/roles/config/Storage backup actually restored and verified; old immutable image and untouched quiesced recovery copy retained within 2 OCPU/12 GB/150 GB and 8 GB backup caps.
- [ ] Before/after full 62 counts+ordered MD5, Auth hashes, 2 sequences, exact schema/RLS/3 approved exceptions, 552 privileges+queue roles/HBA and 73 Storage SHA-256 PASS; mock/sink, load/headroom, dependent clients and tested zero-loss rollback PASS. Link fresh write-once evidence and measured downtime.
- [ ] Do not perform the minor update implicitly during cutover: execute only the exact separately reviewed/rehearsed promotion plan. All other P8/P9 holds cleared, maintenance timing proven, owner DNS/Google actions batched and exact YES CUTOVER received before production actions.

## 5. Write-freeze prerequisite — ZERO-LOSS blocker until rehearsed

`IR35_READ_ONLY=true` plus paused worker is necessary but **not sufficient**: old tabs/SDKs may still call cloud GoTrue/PostgREST/Storage/Realtime directly. Inventory every writer: worker leases/schedules/webhooks, Auth signup/login/refresh/recovery, Storage uploads/deletes, REST/RPC, administrative tools, cron and provider callbacks. Existing cloud service-role/anon keys cannot be assumed frozen because Vercel is read-only.

Read-only audit must establish cloud role/connection privileges and a reversible all-writer freeze mechanism; test equivalent controls on staging with actual attempted writes through EACH old API/role. A default read-only transaction setting alone can be overridden and is not proof. Do not invent superuser privileges, edit production grants/catalogues, revoke roles/keys or suspend the old projects as an unreviewed workaround. Proposed production freeze changes need exact before/after definitions, verified restore and owner approval in the change manifest.

Keep BOTH stacks read-only until final verification and DNS/read-back gates pass. Monitor source table write markers **and** WAL position for2min. Provider background WAL may advance; if the required stability cannot be proved, abort/report rather than relax the invariant to a convenient subset. Capture final snapshot ID/LSN, all sequence state and Storage inventory binding. New uploads/deletes during copy or a changed sequence are FAIL.

## 6. Maintenance timeline — targets, NOT measured promises

Target full maintenance<30min; reverse rollback<15min. Both require actual timed end-to-end staging rehearsal. The read-load8.869s timing is unrelated and must not be used as migration timing. Leave the release date unscheduled while timings are unproven.

| Relative time | Owner | Action / go-no-go evidence |
| --- | --- | --- |
| T-24h or earlier | Owner | TTL300 and previous TTL elapsed; RRset rollback sheet/CAA approved |
| T-60min | Codex, read-only | Fresh free/cost/usage, backup restore available offline, image/config hashes, health, disk, token validity/agent fingerprint, no active real jobs; explicit reviewed manifest |
| T-15min | Owner | Announce maintenance; final human review; exact YES CUTOVER and needed provider/DNS approvals |
| T0 | Approved executor | Enable reviewed old-app maintenance, pause ALL cloud writers by the rehearsed method; do not delete/pause projects |
| T+2min earliest | Executor | Prove2min no source writes/WAL drift; bind final snapshot and sequence/Storage manifest |
| Next | Executor | pg_dump17 + explicit roles/owners/ACLs, consistent Storage transfer, restore to Oracle with ON_ERROR_STOP. New unique run, O_EXCL artifacts, `set -euo pipefail`; no overwrite of prior evidence |
| Next | Executor | Full Verification Standard below PASS, including exactAuth/sequence/Storage/security. Any difference ABORT before DNS |
| Next | Executor | Start verified Oracle app, worker remainsmock/acceptancefalse, health/maintenance still enabled |
| Next | Owner G5 | Apply only four reviewed production DNS records, read back both resolvers/TLS; preserve old RRsets |
| Next | Executor | Live-domain smoke: canonical/admin isolation/health/SSR/jobs/assets/CSP/cache/SDK/auth/storage/no accidental cloud calls; named account +mock only |
| Last | Executor | Disable Oracle app maintenance only after all prior gates. Source stays frozen for rollback; monitor and preserve evidence |

If the copy/verify cannot fit<30min, do not rush/skip tables. Report measured bottleneck and a new owner-reviewed plan before production. ABORT before DNS: keep old service authoritative, undo ONLY the approved freeze through its verified rollback, remove maintenance only after old health/safety PASS. Keep failed Oracle artifacts for diagnosis; no hashes/catalogue edits or destructive cleanup of the source.

## 7. Full Verification Standard — after copy, rollback and every phase

- Schemas public/Auth/Storage/Realtime and inventoried app/platform schemas: columns/types/defaults/constraints/indexes/sequences,owners/grants/defaultACLs/roles,all functions/triggers,extensions+versions,RLS enabled/forced and complete USING/WITHCHECK definitions. Zero differences except owner ONLY for `extension:pg_stat_statements`, `extension:pgcrypto`, `extension:uuid-ossp`, with all original a–d conditions. No other field/extension exception. Queue-role additions remain separately approved, never alter552baseline. Historical `staging-images.json` contains the rejected Storage1.81.0 reference: final release must use the separately proven compatible1.80.2 digest from the actual P4/P5 runtime proof, not blindly reuse that historical list.
- Every62table exact count + primary-key/all-column stable ordered text-cast/framed MD5, using the existing verifier; no skipping empty tables, rows or characters. Auth users/identities/MFA/password hashes match without printing hashes/values. Capture every2sequence last_value/is_called after load. Confirm UTF8/collation/emoji/accented/non-Latin fidelity.
- Every73snapshot Storage object SHA256/byte count/path-hashed manifest, bucket public/private/size/MIME restrictions, physical metadata/xattrs; source may have more objects by cutover, so inventory ALL then, never cap the final transfer at73. Likewise future table/sequence changes expand coverage, not silently dropped to old counts.
- All552 baseline effective app privileges plus queue-role minimality and actual HBA connection denials for every app/clone DB. Original PUBLIC.add_to_waitlist finding stays recorded; queue-only connection boundary must remain effective. No app role gets broader privileges.
- Check exclusive journals, manifest SHA256 before each step, frozen snapshot/sequence/Storage stability. Redacted public report only names/counts/hashes, with private failure logs protected; never expose URL tokens/keys/passwords/customer locators. PASS only if EVERY check matches.

## 8. Lossless rollback, <=48h only — NOT YET EXECUTABLE

**Historical preparation note, before the new P8 source-only script:** An intended future one-command entrypoint is `bash scripts/reverse-sync.sh --dry-run` followed, only under the reviewed owner rollback gate, by the guarded execution mode. That script is currently absent and **must be implemented and tested before release**. There is no working one-command production rollback to claim now. DNS-only rollback is forbidden once Oracle accepted writes.

**30 October correction:** the new P8 script supports dry-run and a disposable Oracle staging rehearsal only; it cannot accept a Supabase cloud/production target. It prepares owned synthetic row insert/update/delete, hashed change/deletion accounting, untouched customer-row checks, full actual source/target fingerprints, all73 Storage bytes/metadata and original62/552/queue/HBA containment before/after.24 offline tests are not native proof: no rehearsal has executed, no native zero-delta or nonempty-delta PASS is claimed, queue-data reversal remains unproven, and managed-cloud Storage object IDs/version/timestamps/backend-locator parity remains unproven. Do not publish a production execution command or label rollback tested until those independent gaps and timed full-native drills are resolved.

The tested controller must: freeze Oracle AND old-cloud writers; capture changed tables and a complete deletion ledger since cutover (updated_at alone misses deletions and tables without that column); export transactionally consistent Oracle data/Auth/sequence/Storage state; reverse-sync into old cloud without overwriting a concurrent writer; preserve roles/ACLs/platform boundaries; compare the full standard; THEN ask owner to restore saved DNS RRsets; smoke old domains; unfreeze only the old authoritative stack. If verification fails, keep both frozen and Oracle data intact, do not flip DNS or drop anything. Rehearse inserts/updates/deletes,FK cycles,sequences,Unicode,nulls,Auth/identities and Storage create/update/delete on disposable targets; a synthetic metadata-only simulator is not the required drill.

Actual Supabase cloud restore privileges and platform-version compatibility are a prerequisite. Do not assume `DISABLE TRIGGER ALL`, superuser, managed-schema DROP/recreate or role ownership changes are permitted. Find a tested least-privilege transfer path read-only first; an unsupported cloud reverse path is a hard release blocker. No cloud write is authorised during this preparation.

Within48h of switch, P0/P1 incident can invoke that verified rollback. After48h, roll forward only. Keep Vercel/Supabase projects intact and source writes held by the approved method for14days; never delete, pause, downgrade or decommission them yourself. On day14 deliver the checklist to owner, not deletion commands. Monitor daily health/backup/errors for14days using the product's recurring mechanism after cutover, not fake idle CPU load.

## 9. End-to-end staging dry-run still required

Use uniquely owned disposable source/target databases and Storage copies behind Basic/noindex,SMTPsink,mockworker only. Rehearse complete freeze→finalsnapshot→transfer→fullverification→host-header/TLSsmoke→unfreeze and then reverse, all without real DNS/provider/cloud writes. Prove timers/heartbeats/queue drain, browser signup/login/recovery/save/mockapply, backup decryption/fullrestore, automaticrollback failure path and cleanup. Record actual full-cycle/rollback timing and per-step manifests. Original P4/P5/pristine fixtures remain unchanged.

NO-GO persists until this staging dry-run and every gate in section1 are evidenced. Stop for exact YES CUTOVER only after—not instead of—these proofs.
