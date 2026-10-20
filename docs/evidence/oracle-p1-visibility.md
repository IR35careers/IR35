# P1 visibility and idempotency continuation —20October2026

## Latest checkpoint: encryption PASS, SSH identity check STOP

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
