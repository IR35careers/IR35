# 30 October owner decisions — bounded P8 execution report

**P8 INCOMPLETE / HARD HOLD. P9 is preparation only / NO-GO. No cutover.** All phase PRs remain draft and unmerged. This report does not replace any failed run, full migration verifier, data hash, assertion or timeout.

## Actual results

| Gate | Result and scope | Evidence |
| --- | --- | --- |
| Owner access | One combined owner handoff after an actual new WSL boot: browser SecurityToken and existing fingerprint-matched SSH key/no lifetime verified. No API passphrase or new key. | Native terminal result; no secrets captured |
| First live Caddy HEADs | PASS: both staging `/jobs` and api-staging `/auth/v1/health` return401, no-store and noindex, Basic challenge/route/request IDs retained. **No activation, config edit, reload or restart.** | [HEAD cases](p8/caddy-head-owner-20261030-01/01-first-heads-result.json), seal `cd979540e5b55cc6992d14b335c88f846b95a1dd111e6741db058ec96cfe5951` |
| Withdrawn advisories | PASS: live security audit and all nine unchanged dependency-security tests. Only original two IDs/packages/versions renewed to30November under explicit owner approval; no workflow/dependency/assertion/backdate change. Intermediate removal and short-reason failures retained. | [Final renewal](oracle-p8-withdrawn-advisories-renewal-20261030.json), [intermediate observation, not final config](oracle-p8-withdrawn-advisories-20261030.json) |
| Free account/resource audit | PASS at15:18UTC: ACTIVE FREE_TRIAL, London home, A1 LIMIT​ED_FREE2OCPU/12GB,150GB live volumes,0volume backups, exact private Standard Object Storage0bytes including versions/unfinished parts, rootquota3match. | [Inventory](p8/backup-iam-owner-20261030-repair01/inventory.json) |
| IAM/lifecycle run01 | FAIL before mutation: exact inventory used a separate metadata transport, leaving an unrelated observed projection empty (`OneAuthenticatedBackupBucketRequired`). | [Retained failure](p8/backup-iam-owner-20261030-01/result.json), seal `57dcca1709f36f8dbe66c3c6e43b10d400a0d0be475487dab5097852149aba71` |
| IAM/lifecycle repair01 | FAIL before mutation: new GET succeeded, but omitted optional `autoTiering`, so strict bucket validator correctly rejected null. Separate exact SDK GET already explicitly requested it and proved Disabled. | [Retained failure](p8/backup-iam-owner-20261030-repair01/result.json), seal `b052398f71610c2323542cc275f8b6d82260709d349725f1b03417e0fae4816d`; [read-only flags](p8/bucket-metadata-diagnosis-20261030-01/bucket-flags.json), seal `9234ca1d9cc64160dd4d1bc9d4d71bb062674c772512ab432203370995eaa618` |
| Final bounded repair02 | **HELD/FAIL, not completed:** interrupted the exact owned controller with SIGINT while it was still doing read-only inventory. Independent source review found a guaranteed later lifecycle response-shape mismatch. `finally` sealed the failed run; no approved mutation intent exists. No fourth attempt. | [Stopped run](p8/backup-iam-owner-20261030-repair02/result.json), seal `f9e2efadc36c0bc7ae68464fc91927a593de0c57ae648c5fcae90123f89b72b1` |
| Lifecycle protocol diagnosis | DIAGNOSED, NOT REPAIRED. Installed CLI3.95.0/SDK2.188.0 serialize kebab-case plus nested null defaults, unlike the controller's camelCase equality. CLI PUT also prompts without explicit confirmation; create-only `If-None-Match:*` is supported. No API request or controller edit in diagnosis. | [Serialization](p8/lifecycle-cli-shape-diagnosis-20261030-01/serialization-mismatch.json), [other findings](p8/lifecycle-cli-shape-diagnosis-20261030-01/additional-public-cli-findings.json), seal `13f617824baff855a86c85c7d75b981e1f0c3f0d68c4069c37727ad6ff60b0db` |
| IAM before/after | PASS unchanged:0dynamic groups,0child policies,1original root policy; original statement SHA unchanged. No lifecycle, IAM or VM change. This is not a claim the planned grants are installed. | [Read-back](p8/iam-hold-readback-20261030-01/result.json), seal `f1c170874f114edcbd8af4cc145a6edc7d84f39f7d20806c556003da2f5cfbbf` |
| Entire offline helper suite | PASS836tests/98.228s in fresh empty HOME, no `.ir35` before/after, no real keys/private files/VM calls, no tests removed. | [Full result](p8-owner-decisions-hermetic-01/result.json), seal `aea45f39d06633afdd8c41dd7bd742aba36dfe5f7d559cdcc4c40e9a96a4a93c` |

The third slot was deliberately stopped, not reported as a third OCI error. Both actual failures and the stopped slot remain separate and immutable. The two permitted repairs have been consumed; a further native IAM/lifecycle attempt needs explicit owner review.

## Exact approved policy text — prepared, NOT created

Single-instance dynamic-group rule, not a compartment wildcard:

```text
instance.id = 'ocid1.instance.oc1.uk-london-1.anwgiljrr72xucychx35t4jbeiaep4qncwolllegqazy3krrryoz7pxqusya'
```

VM writer (`ir35-backup-vm`), only3permissions, NO delete/overwrite/bucket management:

```text
Allow dynamic-group ir35-backup-vm to manage objects in compartment id ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq where all {target.bucket.name='ir35-backups', any {request.permission='OBJECT_CREATE', request.permission='OBJECT_INSPECT', request.permission='OBJECT_READ'}}
```

Regional lifecycle service, child-compartment scope only even though the policy would reside at the root:

```text
Allow service objectstorage-uk-london-1 to manage object-family in compartment id ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq where request.permission='BUCKET_INSPECT'
Allow service objectstorage-uk-london-1 to manage object-family in compartment id ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq where all {target.bucket.name='ir35-backups', any {request.permission='BUCKET_READ', request.permission='OBJECT_INSPECT', request.permission='OBJECT_DELETE'}}
```

`BUCKET_READ` is read-only metadata, not object payload access or bucket management. No service OBJECT_READ is needed for deletion. No tier transitions, version-delete, replication, KMS, tenancy-wide or other-principal grant is added. Proposed rules delete ONLY owned daily7-day/weekly28-day encrypted prefixes; asynchronous expiry is never subtracted from upload-overlap accounting. [Oracle's permission table](https://docs.oracle.com/en-us/iaas/Content/Identity/policyreference/objectstoragepolicyreference.htm) and [lifecycle service requirements](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usinglifecyclepolicies.htm).

IAM projection before and after is identical: root statement SHA `41836268722951511409c9ba1dd2a8b2d293f06e16a9beb7bb694f2302842e9a`; no new resource names or OCIDs were created in this run. Existing A1 and all old-stack resources are unchanged.

## Backup observation blocker — do not broaden the writer

The approved writer can create/list/read objects, but cannot `GetBucket`, `ListBuckets` or `ListMultipartUploads`. The first requires BUCKET_READ; bucket discovery requires BUCKET_INSPECT. Its inability to create multipart uploads does not prove another principal left none behind, or that bucket configuration/account-wide usage stayed unchanged. An old empty list or denied read cannot become zero/fresh evidence.

Two extra bucket permissions alone would still NOT prove other-bucket version/part bytes, shared tier entitlement or all-principal monthly requests. Exact monthly request evidence is an additional conservative helper guard, distinguished from the owner's explicitly exact byte requirement; no count has been fabricated or assertion relaxed. The timer is not installed/enabled and unattended backup PASS is not claimed. A separate narrowly scoped read-only capacity observer design should be reviewed before any additional IAM; writer remains its exact3permissions and fails closed on stale/incomplete proof. An attended owner-authenticated upload is a distinct, limited option, not automated-backup completion.

## Source work completed, native proof still absent

- Ciphertext-only generation/create-only single-part upload library and disposable isolated-cluster restore library:37focused testsPASS. Five encrypted parts plus encrypted commit marker last; owners/ACL/roles retained, private age identity never VM, strict capacity before instance-principal access. The native snapshot holders, actual upload, laptop decryption exit check, full disposable restore and timed drill are **not run**.
- New reverse-sync shell/controller/guest:24offline testsPASS. Disposable-only, owned synthetic INSERT/UPDATE/DELETE ledger, unchanged copied rows, full62/Auth/2sequence/schema/552+queue/Storage verifiers and clone HBA/cleanup are source-wired. Native reversal, queue-data reversal and managed-cloud Storage rollback are **not proved**. The script refuses production/cloud targets; no one-command production rollback claim.
- New read-only14GET header/native adapter and controller: focused tests/complete dependency graph compilePASS, but actual14GET/currenthealth/fullcontainment not run after the hold. No activation path in the read-only adapter. Writable app/mock-ATS browser/Realtime/callback/restart QA remains incomplete.
- Monitoring/alarms remain uninstalled. Existing active topic/subscription is configuration evidence, not email-delivery proof. Built-in metric inventory must be observed before choosing real queries; a custom health publisher must not receive unapproved metric-write IAM.

No new full62/MD5/Auth/2sequence/552+queue/HBA/73Storage native verifier ran in this owner batch: there were no DB, VM, worker, Storage-object or Caddy writes. Earlier full verification evidence stays historical, never substituted for a new restore or phase PASS.

## Always Free envelope at the sealed audit time

| Resource | Observed | Limit |
| --- | --- | --- |
| VM | One London A1,2OCPU/12GB | Approved2/12; never larger trial allowance |
| Live volumes |50GBboot+100GBblock=150GB | Owner150GB, free outer200GB |
| Volume backups |0 | Maximum5 |
| Object Storage | Exact0bytes, Standard/private/versionoff/auto-tierDisabled/no replication | Owner8,000,000,000 including overlap; trial Standard10GB; outer20GB |
| Cost report | GBP net0/positive0 through previous midnight,1row | Lagging only; **not realtime£0 billing proof** |

No paid tier, new resource, replication or upgrade was used. [Always Free reference](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

## Phase disposition and one owner batch

P1–P4 historical approvedPASS; P5SDK401/401/200 historicalPASS; P6 full152mock lifecycle historicalPASS; P7 scoped Auth/sink+StoragePASS with realGoogle/SMTP still deferred. **P8 incomplete/held. P9 runbook prepared in draftPR63, dry-run/release NO-GO.** No production switch and no decommission.

1. Review the two pre-write failures and final stopped slot. Explicitly approve a newly bounded lifecycle CLI protocol repair/run if desired: strict documented response normalization, explicit CLI confirmation, create-only precondition and exact original permissions. No fourth attempt runs automatically.
2. Decide whether to prepare a separate read-only capacity-observer design for unattended backups, retaining the writer's3permissions. Exact new IAM/proof sources must be reviewed before creation; do not blindly grant two bucket permissions or guess global/request usage.
3. Reminder only, not blocker: **store an offline copy of the age key file in your password manager or on a USB drive**. Do not send it here. Existing identity must not be regenerated.

Future Google/DNS/live-SMTP actions and literal **YES CUTOVER** remain deferred until all required staging gates actually pass. No password, token, key or manual Auth-setting copy is requested in this batch.
