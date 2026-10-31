# Backup capacity observer — DESIGN ONLY / NOT EXECUTABLE

31 October 2026. This P9 preparation document advances the full **unattended encrypted backup** target; attended backups are not a replacement end state. No observer, identity, key, policy, endpoint, timer or resource is created here. P8 remains incomplete, P9 remains **NO-GO**, and the separate lifecycle-controller hold still prohibits another native attempt. Exact **YES CUTOVER** is absent.

## 1. Boundaries and unresolved proof

- Keep the writer's exact `OBJECT_CREATE`, `OBJECT_INSPECT`, `OBJECT_READ` permissions on `ir35-backups`; no delete, overwrite, multipart, bucket management or additional grant.
- An observer may inspect metadata, never object payloads, secrets or customer data. It cannot create/delete objects or manage IAM, buckets, lifecycle, networking or billing.
- **A second dynamic group matching the same VM is not an independent identity.** Its grants accrue to that instance principal, not just an observer container/Unix user. Do not claim writer isolation from process names or separate dynamic-group names. Oracle documents the instance-wide privilege boundary in its [IAM guidance](https://docs.oracle.com/en-us/iaas/Content/Resources/Assets/whitepapers/best-practices-for-iam-on-oci.pdf), section “Instance Principals and Dynamic Groups”. A credential broker or metadata-network restriction is not approved as a workaround.
- The owner explicitly requires exact bytes, including versions and unfinished parts, all relevant buckets, upload overlap within8GB, and a stop above80% of the20GB outer allowance or on uncertainty. `p8_backup_policy.usage_budget` additionally requires a fresh exact monthly request count and shared Standard/all-tier totals. This distinction does **not** relax the current guard: its five-minute freshness, request proof and all assertions remain unchanged.

Current blockers are independent: (a) an isolated observer identity/execution location is unselected; (b) authoritative timely shared/account/request evidence is unproved; (c) authenticated ticket trust is unselected; (d) the native lifecycle CLI repair is still held. Designing this document releases none of them.

## 2. Exact metadata operation plan — proposed scopes, not a grant

The current `object_storage_exact.Counter` is the reference algorithm: discover a complete bucket set, page every current/version/unfinished-part listing, count current versions once, compare two complete passes, and rediscover the unchanged bucket set. Missing pages, duplicate identities, ambiguous sizes or changing inventories fail closed. Approximate bucket statistics are never substituted.

| Operation | Metadata permission | Proposed resource scope |
| --- | --- | --- |
| `GetNamespace` without optional compartment parameter | No additional permission | Observer's authenticated tenancy, London endpoint |
| `ListBuckets` | `BUCKET_INSPECT` | Each explicitly reviewed compartment; initially ir35 only |
| `GetBucket` with explicit `autoTiering` field | `BUCKET_READ` | Exact reviewed bucket; initially `ir35-backups` |
| `ListMultipartUploads` | `BUCKET_READ` | Same exact bucket, all pages |
| `ListObjects`, `ListObjectVersions`, `ListMultipartUploadParts` | `OBJECT_INSPECT` | Same bucket; parts only for uploads discovered there |

These mappings follow [Oracle's Object Storage permission table](https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/objectstoragepolicyreference.htm). No `GetObject`/`OBJECT_READ` is needed by the observer. Bucket-name policy matching is case-insensitive: reject case-fold collisions. Operation conditions must restrict broad metadata permissions to these operations, not unrelated reads such as pre-authenticated-request retrieval.

**Initial policy-review envelope, not executable policy:** one independently selected observer principal; `BUCKET_INSPECT` plus `request.operation='ListBuckets'` in ir35; `BUCKET_READ` limited to `target.bucket.name='ir35-backups'` and GetBucket/ListMultipartUploads; `OBJECT_INSPECT` on that bucket limited to the three listed object-inspection operations. No principal or IAM syntax is claimed tested. No policy is installed or widened by this proposal.

This narrow envelope proves at most that compartment/bucket. It does **not** satisfy a tenancy-wide/shared allowance check if root or another compartment/region can contain usage. Existing empty inventories are timestamped observations, not permanent restrictions. Any broader discovery/metadata scope needs a separately reviewed exact compartment/bucket list and owner approval; unknown scope remains `UNPROVEN`, not zero. Two extra bucket permissions alone are therefore not a complete solution.

## 3. Evidence sources that cannot manufacture a PASS

| Requirement | Acceptable candidate / outstanding validation |
| --- | --- |
| Exact current/version/unfinished-part bytes | Complete paged metadata algorithm above, stable double pass, explicit private/Standard/versioning/auto-tier/replication state and unchanged discovery set. Prove real positive and denied-operation tests before trusting a new principal. |
| Shared tier/account allowance | Fresh authenticated account state, subscribed-region and complete allocation scope. Exact read operations/minimal permissions and any source latency must be reviewed; the narrow bucket grant does not provide this. No new account/usage IAM is proposed as already sufficient. |
| Monthly requests across principals and relevant scopes | **Authoritative timely source not established.** Counter.requests counts this audit only, not a calendar month's service requests. An upload ledger counts only its own traffic. Do not set `exact_request_count=true` from either. |
| Planned upload/request reservation | Bind all ciphertext parts, encrypted verification/complete marker, bytes and worst-case operation budget before issuance. Reserve concurrent generations or refuse a second one; never subtract expected asynchronous lifecycle deletions. |

Oracle's [`oci_objectstorage` metrics](https://docs.oracle.com/en-us/iaas/Content/Object/Reference/objectstoragemetrics.htm) are diagnostics, not the exact capacity gate: StoredBytes/ObjectCount are hourly and omit unfinished parts; UncommittedParts is hourly. Empty buckets emit no metrics. AllRequests is a per-bucket series, not demonstrated complete, gap-free, instantaneous global monthly evidence. No series absence means zero. Optional `ListMetrics` and `SummarizeMetricsData` investigation would need separately approved `METRIC_INSPECT`/`METRIC_READ` for exact compartments and namespace; no `PostMetricData`, alarm or metric-write grant. See [Monitoring permissions](https://docs.oracle.com/en-us/iaas/Content/Identity/policyreference/monitoringpolicyreference.htm).

[Cost reports](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/costusagereportsoverview.htm) can arrive late, including up to24hours, and can be corrected. They cannot certify current zero cost or fill the five-minute exact-request gap. Neither metrics nor cost-report access is approved for creation here. If Oracle exposes no suitable exact timely source, report that limitation to the owner. Any alternative conservative request/accounting model requires an explicit reviewed guard/criteria decision; do not silently change the existing implementation, tests or expected values.

## 4. Candidate execution choices — owner review before implementation

1. **Attended interim:** the owner's existing laptop SecurityToken session can perform fresh read-only inventory and hand a one-generation proof over the pinned SSH channel. Normal browser/MFA remains owner-operated; refresh cannot outlive the original daily sign-in limit. No API key is copied to the VM. This may support an attended staging trial after all other gates pass, but cannot be labelled a fully unattended nightly service.
2. **Independent observer, target architecture:** select a genuinely different principal and an already-owned execution context whose availability, identity isolation and zero-cost eligibility are proven. No second VM, paid scheduler/function, external service, API key or new secret is assumed available. Review the exact metadata/account evidence scopes first. If an independent Always Free context and timely authoritative evidence cannot be established, this option remains infeasible/unproved; do not weaken the single-VM or cost rules to implement it.
3. **Same-VM instance-principal expansion:** not compatible with the present writer-three-permission boundary. A separate container, Unix account or second dynamic group on this VM does not cure that conflict. Do not implement it without an explicit owner decision changing the identity boundary and a fresh security review.

### 4a. GitHub federation candidate — not a secret-free shortcut

Oracle's [26 August 2026 IAM release note](https://docs.oracle.com/en-us/iaas/releasenotes/identity/jwt_to_rpst_token_exchange_for_workload_identity_federation.htm) documents external-workload JWT-to-RPST exchange, including GitHub Actions. This is a candidate for a genuinely independent observer, **not an approved or verified deployment**. The [actual exchange specification](https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/token_exchange_grant_type_workload_id-federation.htm) still requires a configured identity-propagation trust and an authenticated exchange caller: an OAuth client or an OCI service/instance principal. A GitHub OIDC token alone is therefore not proof that our unattended, no-static-secret architecture is available. Do not copy an OAuth client secret into GitHub or invent an exchange broker. Default-domain availability, exact principal/claim restrictions, caller authentication, zero-cost eligibility and the ticket-verification path all remain unverified owner-review items. No identity domain application, trust, key, client secret, workflow or new IAM policy has been created.

## 5. Generation-bound ticket contract — proposed, not implemented

The writer must receive a narrowly bound, authenticated proof, not a general “capacity OK” boolean. A future reviewed ticket contains:

- Format/version, observer identity, tenancy/region, exact compartment/bucket-set hash and account-state evidence hash.
- Unique generation ID and nonce, writer audience, immutable source commit, ciphertext-part names/sizes/SHA-256 plus complete-marker reservation, and their combined manifest hash.
- UTC audit start/end, issue/expiry times, complete source-request counts, exact byte totals by bucket/tier including versions/unfinished parts, global-scope coverage and monthly-request proof source/window/hash. Unavailable values are `UNPROVEN`, never0/defaulted.
- Stable-pass/discovery hashes, budget result, all planned requests, reserved concurrent usage and an immutable evidence-manifest hash. Public reports contain names/counts/hashes only; raw object paths are not published.

Expiry is no later than **five minutes after the authenticated observation time**, preserving `usage_budget` unchanged. Long or inconsistent audits fail; clocks must be checked. Validate signature/trusted channel, exact scope, nonce, generation, audience, current ciphertext hash, complete evidence, expiry and available reservation before **every** PUT. Reject wrong/missing/expired/replayed/altered proofs, unknown signer, denied reads, pagination gaps or changed account/bucket state; no cached-success or automatic fallback. A failed or ambiguous upload consumes its intent and requires read-back reconciliation before any new generation.

Ticket authentication is an unresolved security design item. No new signing key, HMAC secret or verifier is created here; do not reuse OCI/SSH/age/JWT/application keys for ticket signing. A later dedicated signing-key ceremony/trust installation would need explicit owner approval and approved private custody. Existing pinned SSH can protect an attended handoff, but does not create an autonomous signing service. A same-host root process cannot turn an untrusted arbitrary ticket into authenticated evidence merely by writing it to a file.

## 6. Evidence required before unattended enablement

- Independently approved principal/location and exact read-only policies, real allow/deny tests, no writer permission change or payload/secret access, and fresh Always Free scope reconciliation.
- Actual complete count proof, authoritative monthly/shared-allowance coverage or an explicitly owner-reviewed replacement model; no uncertain totals or relaxed existing guards.
- Ticket custody/authentication, expiry/replay/tamper/concurrency tests; complete write-once sealed journal and unknown-outcome reconciliation.
- Repaired, separately reopened lifecycle gate; actual encrypted upload/read-back, full disposable restore and timed drill with62tables/orderedMD5/Auth/2sequences/schema3exceptions/552+queue/HBA/73Storage verification.
- Only then a tested nightly timer and stale-backup alert without real mail/employer side effects or broader IAM. Keep the timer disabled until every required gate passes.

This design is not a backup, restore, P8 signoff, end-to-end P9 dry-run or permission to execute. Production/DNS/Google/Supabase/Vercel and real secrets stay unchanged. Human review and the literal **YES CUTOVER** gate remain mandatory.
