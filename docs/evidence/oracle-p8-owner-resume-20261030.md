# P8 resumed owner batch — custody PASS, lifecycle permission hard stop

30 October 2026. **P8 is incomplete; P9 is preparation only / NO-GO.** No production, DNS, Vercel, Supabase cloud, Google, real-mailbox, employer, database or queue change occurred. No cutover approval was received. The owner explicitly resolved the earlier folder gate; those failed artifacts remain unchanged.

## What actually passed

- [Approved ACL + one real age ceremony](oracle-p8-owner-custody-resolved-20261030.json): inheritance converted to explicit current-user+SYSTEM Full Control, owner/contents unchanged, original `icacls /save` backup retained outside Git (SHA256 `03bb6ab14d2ff505f87800405a00d669d0aa686599411c108e507192c8af2185`). One generated identity is owner-only outside Git. Official publisher/Sigsum verification and actual offline 85-byte Unicode/binary encrypt/decrypt round trip PASS. No private identity output, VM or bucket copy; never regenerate it.
- [Fresh exclusive native/OCI audit](p8/owner-resume-readonly-20261030-01/result.json), [seal](p8/owner-resume-readonly-20261030-01/manifest.json): SHA256 `aff7d4de5e906dccb5fc30a58b3a86a07016a3428142effa48e0199f2b48ec66`. Read-only SSH connected with the existing fingerprint-verified no-lifetime key. Oracle used fresh browser SecurityToken, never the API key/passphrase. The audit made42 resource/account reads,14 exact Object Storage reads and6 IAM/monitoring metadata list reads; zero cloud/VM/IAM writes.
- [732 fresh-home helper tests](../evidence/p8-owner-resume-hermetic-01/result.json) PASS107.64s, seal `9f1bb8f1baf7084f5eb3b148fad311e511e742ab34518255373f02172a070636`; no `.ir35` before/after, no private files/keys/VM calls, no removed tests. Thirteen new read-only header-audit fixtures and four new preflight tests are included. One initial new static test rejected the lowercase output label `restartCount`; projection now uses Docker's canonical `RestartCount` field. No command, assertion, expected value or timeout was weakened, and no native attempt occurred before its four tests passed.

## Fresh Always Free evidence — not a real-time billing guarantee

| Item | Authenticated result | Constraint |
| --- | --- | --- |
| Account/region | ACTIVE FREE_TRIAL, uk-london-1 READY/home | No PAYG/upgrade/trial-only resource authorized |
| VM | VM.Standard.A1.Flex / LIMITED_FREE,2 OCPU/12 GB |2 OCPU/12 GB total owner ceiling |
| Live boot+block |150 GB |150 GB owner cap;200 GB free live-volume outer limit |
| Volume backups |0 |Maximum5; no backup created |
| Object Storage |Exactly0 bytes, including versions and unfinished multipart parts |Private Standard only;8 GB owner aggregate including upload overlap;20 GB outer free cap |
| Quotas |All3 exact root quota statements match |No quota edit |
| Monitoring |Existing ir35-alerts topic/email subscription ACTIVE;0 enabled alarms |No email sent, alarm or subscription changed |
| Real-time zero bill |NOT PROVEN |A lagging cost report is not proof of an instantaneous£0 bill |

## Caddy — inspected, not changed

Live `ir35-staging-caddy-1` is2.10.2, expected immutable image `sha256:8dbca3525dd8dce671e495665a0eb297a83ec87ee30f373947d0ea93115949db`, running since24October12:38UTC, restart count0/OOMfalse. Exact read-only config mount/hash `2a4fad8dd6c35c3708c1d5a382f88dd105475cf54dc5d10425771da19758a49a`; admin and persistence are off. No config backup/edit/reload/restart/activation was attempted. [Native projection](p8/owner-resume-readonly-20261030-01/01-caddy-inspection-result.json).

That pinned version has no supported signal reload, and `caddy reload` requires the disabled admin API. An actual required repair cannot satisfy the current reload-only boundary. However, the historical public config already includes immediate and deferred headers, unlike the unused private QA config that failed CI. The earlier fresh public root401 had no-store/noindex; **do not assume every live response is broken or claim all live cases pass**. New injected-only14GET header/SDK/HTTP80 audit source is tested but NOT run natively. Do not induce live upstream failures. Source-only private QA error-handler repair preserves original6cases/expectations/timeouts and adds4synthetic error-path cases; hosted CI on the new commit remains pending at preparation time.

## Actual hard stop: lifecycle service permission absent

[Complete root+child policy inventory](p8/owner-resume-readonly-20261030-01/lifecycle-service-prerequisite.json) shows one active root policy/one statement, no Object Storage service statement, no child policy and zero dynamic groups. Therefore the required lifecycle service authorization is absent; it was not inferred from an operation failing or a token search. No group, policy, lifecycle rule, public recipient transfer, timer or upload was created.

The separately approved VM policy remains exactly this **PREPARED / NOT CREATED** statement:

```text
Allow dynamic-group ir35-backup-vm to manage objects in compartment id ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq where all {target.bucket.name='ir35-backups', any {request.permission='OBJECT_CREATE', request.permission='OBJECT_INSPECT', request.permission='OBJECT_READ'}}
```

Group matching rule: `instance.id = 'ocid1.instance.oc1.uk-london-1.anwgiljrr72xucychx35t4jbeiaep4qncwolllegqazy3krrryoz7pxqusya'` only. VM DELETE/OVERWRITE/bucket management are forbidden. Single-part create-only upload is required; do not use multipart/CLI stdin convenience, which needs broader rights.

Oracle requires a **different principal**, `objectstorage-uk-london-1`, to carry out lifecycle deletions. The documented restrictive service permission set includes BUCKET_INSPECT/BUCKET_READ/OBJECT_INSPECT/OBJECT_DELETE; do not copy the broad manage-object-family example, grant VM DELETE, or assume an unavailable request condition can narrow a bucket-inspection operation. Any exact least-privilege service policy needs separately approved scope and tested condition applicability first. [Oracle lifecycle service permissions](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usinglifecyclepolicies.htm#Required_IAM_Policies), [permission/condition reference](https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/objectstoragepolicyreference.htm).

## Phase status — no substitute for full verification

| Phase | Status |
| --- | --- |
| P1–P4 |Historical scoped PASS in drafts49–53; no new migration/clone/restore in this batch. |
| P5 |Historical actual SDK401/401/200 PASS; source header repair prepared. Fresh full native writable fixture remains unexecuted. |
| P6 |Historical152 mock lifecycle checks PASS in draft57; no queue job/worker restart run in this batch. |
| P7 |Historical revised Auth/sink/Storage scoped PASS in draft61; no provider/cloud setting or real email change. |
| P8 |**BLOCKED**: lifecycle permission; encrypted automated backup, disposable restore/full62MD5/Auth/2sequences/3exceptions/552+roles/HBA/73Storage, exact managed-cloud reverse path, writable browser QA and monitoring still unproven. No fresh full-containment PASS claimed by these read-only version/resource checks. |
| P9 |Draft63, updated PG17.11 checklist/preparation only; no17.11 image selection/pull/update, real end-to-end dry-run/timing or working one-command zero-loss rollback claimed. **NO-GO**. |

The prior two dependency exceptions expired29October. Do not extend/backdate/ignore them to make security CI pass. New source requires actual current CI evidence; old green checks at7ab8c2b are not new-source proof. All PRs remain draft/unmerged and production deployment holds stay unchanged.

## One remaining owner list

1. **Lifecycle permission:** approve or decline a separate least-privilege grant for Oracle's regional Object Storage service to expire only this backup bucket's owned encrypted backup prefixes. VM permissions stay exactly three/noDELETE. The documented service bucket-inspection prerequisite may require compartment-level inspect metadata; report that scope explicitly rather than hiding it inside a bucket condition. No additional IAM is currently approved or created.
2. **Conditional Caddy scope:** if the fresh full live header audit finds a required defect, reload-only cannot repair this actual2.10.2/admin-off runtime. Decide whether one controlled staging-only Caddy recreation/restart with retained config/image and automatic rollback is permitted. Do not restart it merely because approval exists; first prove a repair is needed. No new admin exposure, DB change or version upgrade is requested.
3. **Offline custody:** store an offline copy of the age key file in your password manager or on a USB drive. Path: `C:\Users\anves\.oci\ir35-p0-readonly\oracle-backups-age.identity`. Never paste its contents; never transfer it to the VM/bucket/Git.

No further login/passphrase/Auth-setting handoff is requested in this owner list. Exact **YES CUTOVER** remains absent. No wider permission or production authority is inferred from this report, a completed sign-in or an automated continuation.
