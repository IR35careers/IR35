# P1 visibility and idempotency continuation —20October2026

## Superseding final P1 PASS

Owner explicitly reopened the bucket read-back and authorised two tested self-heal retries. Final execution **PASS**, no creates/updates: bucket OCID/spec matched, `autoTiering` was requested explicitly and read **Disabled** (no null-to-default inference), Standard/private/versioning Disabled/events off; independent GET count0/bytes0 plus full unfiltered empty object listing PASS. The pinned CLI represents that exact empty listing as `{"prefixes":[]}` without a data key; only that exact envelope/command is accepted, with independent zero-count/size proof. Missing/malformed/filtered/paginated responses still fail. Final signed account/all-compartment/all-AD volume/cost/budget and attached network verification PASS. Envelope: one A1 2OCPU/12GB, 50GB boot +100GB block, zero volume backups, zero object bytes; caps150GB/five/8GB preserved. Budget/ACTUAL alert active; lagging zero cost is **not** real-time £0 proof.

[Resource evidence](oracle-p1-visibility-resources.json) now records **15 verified resources, phaseComplete=true, no pending or blocker**, Notifications ACTIVE, host cleanup/fingerprint and post-reboot mount proof. Owner-reopened attempt count3/failures2 is retained rather than reset. Both failures were read-only helper representation bugs, not data/configuration changes or resource retries. Original IDs, format and IAM cleanup are unchanged. **126 Linux units, six actual installed-CLI suites plus final bucket-GET binding probe PASS**. Current-head CI remains separate. P1 draft49 stays open/unmerged; P2 gets its own draft. No app/database migration/production/DNS/provider/real-employer/runner/cutover change.

Oracle's [GET documentation](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/os/bucket/get.html) explicitly lists optional `autoTiering`, `approximateCount` and `approximateSize` fields. The prepared null-normalisation idea was discarded **before any live execution** in favour of requesting actual evidence. Historical blocked checkpoints below explain prior attempts, not current state or an instruction to recreate resources.

## Current checkpoint: owner email ACTIVE; P1 held on bucket read-back

The owner confirmed the Notifications email. An independent signed subscription GET now reports **ACTIVE** and exact topic/EMAIL endpoint/spec match; no second subscription or confirmation-token capture. Topic and subscription OCIDs are in the allowlisted [resource evidence](oracle-p1-visibility-resources.json). This proves confirmation, not a P8 alarm-delivery drill.

| Check | Current result |
| --- | --- |
| Instance, boot and same 100 GB PV data encryption | PASS; no repeated instance update/attach |
| Fresh console-first capture, 10 MB bounded RAM read | No fingerprint block; owned fresh capture deleted, GET404 |
| Conditional exact-VM temporary group/policy | Public-fingerprint command succeeded once; both deleted, GET404 and LIST absence |
| Guest ED25519 fingerprint over approved Bastion path | PASS, independently matched and pinned |
| Verification Bastion session cleanup | PASS, DELETED |
| Unique blank 100 GiB disk / ext4 / UUID / nofail / reboot | PASS; one format only, boot ID changed, mount present without manual mount |
| Notifications topic and owner-confirmed email | PASS; ACTIVE |
| Existing backup bucket final identity/empty listing | HELD; bucket exists, final reconciliation incomplete |
| Whole P1 / P2 | NOT PASS / NOT STARTED |
| Production, DNS, Vercel, Supabase, real employers, runner/acceptance | Unchanged / no actions |

Public guest fingerprint only: **`SHA256:LXG3TxAqJf2PT3Y8Zf0mi7mE0UeXd9BUYApmptWVX4o`**. No raw console, host public-key material, private keys or command output containing credentials is exported. Temporary group, policy and short-lived verification session IDs remain in the private cleanup journal, not published as live resources. The older initial diagnostic console snapshot is not claimed deleted by cleanup of the new owner-requested capture.

**Gateway trust limitation:** signed Session GET (including a raw signed HTTPS check) returned a null Bastion public gateway key. The only outer-gateway first-use recording was an isolated **public keyscan**, with no guest login, guest command, password, secrets or agent forwarding. Guest identity still had to match the authenticated OCI Run Command fingerprint before enrollment. Subsequent guest commands use the pinned key and `StrictHostKeyChecking=yes`. The outer gateway key is **not** claimed independently/out-of-band verified. Changed/mismatched guest or gateway keys never get overwritten. This narrowly scoped bootstrap decision and tests must remain visible in review.

Guest data disk `/dev/sdb`, recorded UUID `ccf200ea-4ebb-4775-b7ce-75f5074de79d`; final `df -hT`: ext4, **98G size, 24K used, 97G available, 1%, /opt/ir35/data**. A post-mkfs lsblk read-back lag stopped before mount; direct blkid proved the recorded UUID, udev was refreshed, and the resumed preparation reported **formatPerformed=false**. No second format. Fstab uses UUID/nofail; reboot verification did not invoke mount. Host hardening/Docker/app deployment remains P2+.

### Failed-step stop and prepared repair (not executed live)

1. After exactly one bucket create, `os bucket list` omitted tags by default. Strict ownership validation correctly stopped. Official [BucketSummary documentation](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/os/bucket/list.html) requires `--fields tags`; requesting that does not weaken collision checks.
2. The first resumed finish run stopped locally at `Pending finish resource must reconcile before any create.` It revisited completed associations before the pending bucket. No create call ran. Pending-first ordering and a unit regression were added; six actual installed-CLI suites passed again.
3. The next resumed read-back stopped at **`Invalid local public OCI identifier; no request made.`** Specifically, BucketSummary also has **no OCID**; the local ID check failed before the follow-up full bucket GET, not before every read-only LIST. No duplicate create or configuration change ran. This reached the failed-step limit; no more provisioning attempt, P2 start or automatic loop.

The proposed narrow fix is now source-prepared: exact LIST name/tags/parent existence, then **independent full bucket GET** for OCID and full spec, comparing it with the persisted pending ID. Tests now model an actual ID-less BucketSummary, reject mismatched GET identity and prove no create for an existing bucket. **123 Linux units PASS**. The private durable stop is `bucketReadback / BucketSummaryIdentifierMissing`, pending ID preserved. This repair has **not** been executed against OCI, and final-current-source CLI proof must be renewed before any authorised continuation. No cloud API retry was made after recording this hold.

Full release checks earlier in this delivery passed strict TS/zero-warning lint, **930 unit tests/141 files + 199 legacy checks**. After the final source-only BucketSummary/hold patch, **all six actual installed-CLI suites PASS again (98.010 seconds)**, clients intercepted before cloud/socket/browser operations. All **123 Linux units PASS**; source/history scan passes **806 tracked files**, whitespace check PASS. This is offline verification, not permission to clear the live hold or a bucket read-back PASS. All ten hosted checks were successful on earlier implementation `06cea4a`; the next pushed head needs its own CI. Public evidence exports only metadata, names/counts/hashes/allowed public OCIDs, with 14 independently verified resources and a pending bucket, **phaseComplete=false**.

Allocation remains one A1 **2 OCPU / 12 GB**, **50 GB boot + 100 GB block**, public IP **132.145.28.134**, London. Fresh signed free/account/tenancy usage/cost/budget checks preceded actual creates. Existing £1 budget/100% ACTUAL alert remains; a budget is not a cap and lagging zero cost rows are not real-time £0 billing proof. Final bucket bytes/network/aggregate phase read-back remains outstanding. No upgrade, paid plan, extra volume, data migration or production change.

## Historical checkpoints (not current status or retry authority)

## Latest checkpoint: encryption PASS, SSH identity check STOP

**Active owner-specific continuation:** fresh console-first capture/retrieval completed; no explicit fingerprint block; new capture deleted with independent GET404. Owner's conditional exact-VM IAM fallback is now approved and executing. Exact group and restricted policy read back correctly; one public-fingerprint command remains ACCEPTED during the documented propagation window. Temporary IAM cleanup is not yet proven, and no guest host key is pinned. New tests pass 113 Linux units; no disk format/mount/P2/production work. Do not interpret the historical “permission decision pending” paragraph below as current. Final results will supersede this in-flight checkpoint.

### Resume audit: Run Command prerequisite absent; no IAM expansion

After the owner requested resume, SecurityToken refresh failed before the first instance read. One normal browser sign-in completed and was verified, with owner confirmation; no API/SSH passphrase. Signed instance GET and complete plugin LIST confirm RUNNING VM and **Compute Instance Run Command: RUNNING**. Signed tenancy dynamic-group LIST contains **zero groups**. Root and ir35 policy LISTs contain **zero relevant dynamic-group/instance-agent execution grants**. These calls are read-only; no command was created, no IAM permission changed and no instance/volume/console capture was repeated.

Oracle's [Run Command IAM instructions](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/instances.htm#Run) require an instance dynamic group plus command-execution permission. Plugin RUNNING alone is not execution proof. The requested permission repair is **not yet approved or executed**: one temporary group matching only this existing staging VM, one ir35-only `instance-agent-command-execution-family` permission constrained by `request.instance.id=target.instance.id`, no Object Storage/admin/database grants, and removal of the temporary group/policy after authenticated public host-key retrieval and comparison. Existing owner caller privileges remain unchanged. Owner-assisted authenticated console verification is the alternative; no insecure SSH fallback. Dynamic-group propagation may take up to 30 minutes according to Oracle; no remote command result or timeout is claimed.

All ten hosted checks on implementation commit `06cea4ade0e2e1ffe0d84e8c48ef642635563d6d` passed, including native ARM mock, Docker/Postgres standby and three responsive browser projects. It remains draft/unmerged. That is not P1 success, VM health or new-head documentation CI. No GitHub deployment was recorded for that implementation head at read-back. P1 resource/guest work remains paused awaiting the new narrow IAM decision or authenticated owner console evidence.

### Completed encryption repair (unchanged)

Owner-authorised in-place repair executed on the existing Always Free A1 (2 OCPU / 12 GB, London), not a replacement VM:

- Signed image GET verifies the original Oracle platform image: Canonical Ubuntu 24.04 aarch64, no custom compartment/Marketplace listing. Boot and remote-data launch types are PARAVIRTUALIZED.
- One instance update set only `launchOptions.isPvEncryptionInTransitEnabled=true`. Approved empty-staging reboot completed; shared bounded polling independently verified RUNNING and the flag true. No second instance update.
- Complete signed boot-attachment LIST verifies the exact instance/boot-volume pair, ATTACHED and `is-pv-encryption-in-transit-enabled=true`. OCI returned the instance OCID as this attachment's ID; a local OCID-type assertion was narrowly repaired to use the actual parent pair, without recreating the VM or repeating update.
- After reconciling the earlier definitive rejected 400 and zero matching attachments, exactly one new encrypted attachment request succeeded for the **same 100 GB volume**. Independent GET verifies ATTACHED, paravirtualized and encryption true. Attachment OCID: `ocid1.volumeattachment.oc1.uk-london-1.anwgiljrr72xucycxrovxjhm7q2aoudyr55wnguk6uaivoguk73cj27uwkfa`. The API device hint is null, so guest disk inspection is mandatory before identifying a format target. No unencrypted fallback, detach/recreate or additional allocation.
- Fresh normal-browser SecurityToken sign-in passed after refresh failed. Owner alone completed login/MFA. No API/SSH passphrase was requested; the existing SSH key remains agent-loaded and encrypted on disk.

### New failed check and read-only diagnosis

One tagged OCI console-history capture succeeded. Only fingerprints/metadata were extracted in RAM; raw console content was never published or retained in source. Public SSH keyscan is reachable, but the initial content slice has no SHA256 fingerprint. The documented full bounded read (`offset=0`, `length=1048576`) returned **120,684 characters, zero SHA256 fingerprints**. Consequently **no authenticated SSH host key was enrolled**. This is missing evidence, not a proven changed/mismatched key. No StrictHostKeyChecking bypass, password login or TOFU fallback.

The private durable journal records `sshHostTrust / ConsoleFingerprintMissing`, real failure. No authenticated SSH command, guest `lsblk`, disk format/mount, persistence reboot, bucket/topic create or P2 hardening ran after this hold. The successful encrypted attachment remains intact. Source tests cannot turn this live check into PASS.

**Proposed next specific repair:** inspect whether the existing OCI Run Command agent can return only the public Ed25519 host-key fingerprint through authenticated OCI, with no IAM expansion, paid service or raw secret output. If unavailable, use an owner-authenticated serial-console fingerprint. Compare the authenticated fingerprint to keyscan before pinning SSH, then inspect the unique blank 100 GB guest disk. Do not create another console capture, disable verification, format an ambiguous disk, clear the failure generically or restart provisioning blindly.

| Latest check | Result |
| --- | --- |
| Oracle platform image / boot+data PV launch type | PASS live |
| In-place instance update / RUNNING / encryption true | PASS live, one update |
| Boot attachment PV encryption | PASS live, true |
| Same 100 GB encrypted PV attachment | PASS live, one attachment |
| Authenticated SSH host-key fingerprint | FAIL: absent from full console snapshot |
| Guest inspection / ext4 / UUID mount / reboot persistence / df | NOT RUN, blocked before SSH |
| Backup bucket / Notifications topic / final P1 signoff | NOT RUN after new failure |
| P2 | NOT STARTED, separate draft PR required after P1 PASS |
| Production / DNS / Vercel / Supabase / worker / acceptance changes | NONE |

Public IP remains **132.145.28.134**. Live allocation remains **50 GB boot + 100 GB data = 150 GB**; no extra compute/volume or paid plan. Existing £1 budget/ACTUAL alert remain; prior signed eligibility/budget/cost read-backs preceded the narrow repair and console capture. Lagging cost data is **not** real-time £0 billing proof. Full created-resource IDs plus the new hold are in [allowlisted JSON evidence](oracle-p1-visibility-resources.json); prior `attachmentDiagnostic` is explicitly historical. Health/browser/database readiness is not yet available because no application is deployed.

References checked: [Oracle instance launch prerequisite](https://docs.oracle.com/en-us/iaas/tools/python/latest/api/core/models/oci.core.models.UpdateLaunchOptions.html), [platform/paravirtualized volume encryption](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumeencryption.htm), [console snapshot length/offset and stdout](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/compute/console-history/get-content.html). No claim that Oracle guarantees fingerprints in every snapshot.

Final local verification: **93 Linux unit tests PASS**, including false instance flag before any API, encrypted attachment/reuse, new unrelated failure cannot be cleared by the old repair, missing/mismatched console fingerprint refusal, exact boot parent pair and credential-redacted service messages. **Six installed-CLI suites PASS** with cloud clients intercepted; the updated full-snapshot length/offset command also passed its isolated real-parser probe. One local harness failure (`StringIO` missing binary stdout) was repaired to a private binary-capable sink without removing the client-call assertion. **32 TypeScript capacity tests, strict TypeScript, zero-warning ESLint, whitespace and source/history secret scan (798 tracked files) PASS**. These tests use fixtures, not real cloud creates or employer submissions. Vercel main/Oracle deployment holds remain disabled. Draft [PR #49](https://github.com/IR35careers/IR35/pull/49) remains unmerged; final-head hosted checks are separate, not claimed PASS here.

## Historical first attachment failure (resolved by the repair above)

## Verified checkpoint

**FINAL STOP —real API400, not eventual consistency:** the A1 VM is independently RUNNING on the first launch,2OCPU/12GB, official Ubuntu24.04aarch64; boot50GB and separate block100GB independently verified. PublicIP **132.145.28.134**. Exact owner/public and Bastion/private SSH /32s, no broadIPv4/IPv6SSH, only explicit SL/empty NSG attached; public80/443 only. Full resource OCIDs/visibility/readback metadata are in the [JSON evidence](oracle-p1-visibility-resources.json), including the boot volume ID. One capacity attempt, no capacity failure/retry. No host/application/data/worker deployment.

The first encrypted paravirtualized data-volume attachment request failed **InvalidParameter /HTTP400**. Stopped all provisioning immediately, retained its pending intent, no second request, no unencrypted fallback, no delete/recreate. Read-only reconciliation finds **zero matching attachments**, VM RUNNING,100GBvolume AVAILABLE. VM launch options report `is-pv-encryption-in-transit-enabled=false`; requested attachment encryption wastrue. **Inference, not a proven full provider-message diagnosis:** the mismatched instance launch option is a likely prerequisite problem. Raw provider response was suppressed/discarded; the exact retained error is code/status, not an invented message.

Proposed next reviewed repair: check the existing official image/shape's supported in-transit-encryption update path; enable the existing instance's required launch option if supported (may need a staged stop/start), independently verify, then reconcile the same pending attachment before one new attempt. Do not recreate the VM/volumes, set encryptionfalse, clear the journal or retry automatically. [Oracle's UpdateLaunchOptions prerequisite](https://docs.oracle.com/en-us/iaas/tools/python/latest/api/core/models/oci.core.models.UpdateLaunchOptions.html), [attachment encryption](https://docs.oracle.com/en-us/iaas/Content/Block/Tasks/attach-compute-volume-attachment.htm). No instance update was executed.

**P1 incomplete, P2 not started.** Attachment, backup bucket, Notifications topic/subscription and final resource signoff remain unfinished. ExistingGBP1budget/ACTUALalert retained, no upgrade. No production/DNS/Vercel/Supabase/worker/acceptance change. Final83Linux units PASS, including a held-entrypoint regression proving authentication/OCI cannot run past the recorded400stop.6installed-CLI suites pass separately; parser success is not service API success. TypeScript/lint/source checks below refer to their actual completed runs, not a full app/Oracle health PASS.

Final source/history scan792trackedfiles PASS; strictTypeScript, zero-warningESLint, whitespace and static Vercel main/Oracle deployment holds PASS. Existing draftPR49 remains human-review-only. Final-head hosted CI remains separate; no production deployment, registry publication, updater or acceptance enablement.

**Network continuation:** VCN, internet gateway, route table, restricted security list, empty NSG, public subnet and Bastion independently read back. See [names/OCIDs/visibility events](oracle-p1-visibility-resources.json). Bastion remained CREATING through5/10/20s backoffs and became ACTIVE after43.282s, no create retry. No other inbound ports/default SL attachment is requested. Exact private Bastion ingress/VM validation is the next compute gate, not a completed host-health check.

Final local scope so far:78Linux tests,32TS capacity/planner tests, strictTypeScript/zero-warningESLint and5actual CLI probe suites PASS. Probes exercise27create/get/list commands plus6inspection/narrow-ingress calls with cloud clients intercepted. First infrastructure entrypoint correctly refused a missing current-source proof while its probe was running; no cloud call/create. A later prospective storage guard received an internal Decimal instead of supported boundary number/text and stopped before create; repaired to exact decimal text, regression passes. No validator or free cap bypassed.

Existing compartment reused; exactly one root quota create, independent GET ACTIVE with exact three statements. Root LIST identity/tags and child/selected-AD effective quota values2OCPU/12GB/150GB PASS. These quotas are AD-scoped, not an aggregate regional spending cap. Independent tenancy-wide2/12/150/five-backup/8GB Standard guards remain mandatory. Existing£1budget/ACTUALemailalert preserved; lagging cost reports are not real-time£0 proof.

| Resource | Verified OCID |
| --- | --- |
| ir35 compartment | ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq |
| ir35-always-free-cap root quota | ocid1.quota.oc1..aaaaaaaafepky5snnvksd25mi3jzwqg4rmxkwxaa575dbwb4uacn6sxgucrq |

## Shared wait / failure policy

`visibility.py` takes read-only callbacks, no create callback. Poll intervals5/10/20/40/60seconds, capped60, total600including reads.404 or codeNotAuthorizedOrNotFound with no conflicting status is NOT_YET_VISIBLE only inside this window;401/500/unknown errors immediately fail. Missing LIST entries/pending lifecycle may wait; identity/tag/config mismatches fail. Each observation is atomically journalled, including elapsed time/status/poll delay, outside Git. Reports contain metadata only; no provider messages or credentials retained.

All create paths lookup name+intent tags before one mutation, save durable intent first and reuse independent exact GET matches. Unknown create outcomes/pending intent only reconcile: even an empty eventually-consistent list never permits a second create. Home region pinneduk-london-1/profileir35/SecurityToken for IAM and other operations. No API-key fallback, new passphrase prompt, permission expansion or Console quota action.

The first quota GET passed. A local follow-up assertion then incorrectly compared statements against OCI's **QuotaSummary** LIST model, which has no statements field. Documented repair: retain exact GET statement verification; LIST verifies unique ID/name/parent/tags/state; effective resource-availability reads prove child limits. Reused the existing quota, no additional mutation. Regression fixture includes actual summary field shape.

## Checks so far

| Check | Result |
| --- | --- |
|83Linux units, including404→success with one create,600s timeout,401/500 immediate failure, exact name/tag reuse and real-failure hold | PASS |
| Root quota GET / LIST / effective2/12/150 | PASS live |
| Existing compartment reuse | PASS live, no duplicate |
| Network/Bastion/VM/boot50GB/block100GB independent readbacks | PASS live, first VM launch |
| Encrypted data attachment | FAIL API InvalidParameter/400; no retry |
| Remaining P1 bucket/notification/final signoff | NOT RUN after real failure |
| Production/DNS/Vercel/Supabase/runner/acceptance change | NONE |

References checked20October: [Compute quota names/scopes](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/resourcequotas_topic-Compute_Quotas.htm), [Block quotas](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/resourcequotas_topic-Block_Volume_Quotas.htm), [Always Free including150GB within200GB, fivebackups, trialStandard10GB, freeBastion](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). Live signed FreeTrial/home-region/budget/storage/shapeLIMITED_FREE checks preceded the quota mutation. No claim of host capacity from quota availability.
