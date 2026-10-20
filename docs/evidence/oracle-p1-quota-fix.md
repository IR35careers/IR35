# P1 owner-specific quota fix — 20 October 2026

## Outcome

The previously failed **local CLI wiring check is repaired and PASS**. P1 is **not complete**: stopped once on a new initial compartment-readback HTTP404. One create succeeded; read-only reconciliation proved the existing resource ACTIVE with exact parent/intent tags. No duplicate create, quota create, Compute launch, network/volume/bucket or production change occurred. No permission escalation/API-key fallback/Console action was used.

| Check | Result |
| --- | --- |
| 55 Linux unit tests | PASS |
| Three installed CLI wiring tests, cloud/browser operations intercepted | PASS |
| All quota create/get/list wiring uses `limits quota` | PASS |
| Actual live quota definitions/support/scope | PASS, all three names below |
| Existing SecurityToken session and loaded SSH agent | PASS, no new secret prompt |
| Fresh signed account/Free Trial/London/usage/storage/budget/cost gate | PASS before the compartment create; lagging cost data is not real-time£0 proof |
| Compartment first independent GET | FAIL: NotAuthorizedOrNotFound /404; no create retried |
| Read-only list + one subsequent GET of that existing compartment | PASS: ACTIVE, exact parent/name/intent tags |
| Root quota create, root-list readback and effective-limit propagation | NOT RUN after new failure; no Terraform fallback triggered |
| Full P1 / VM / host health | NOT COMPLETE / NOT RUN |

Final source-only checks: strict TypeScript, zero-warning ESLint, source/history779trackedfiles, whitespace checks and static Vercel main/Oracle deployment holds PASS. Final-head hosted CI remains separate; no green generic CI substitutes for actual quota/host sign-off.

Created and independently reconciled resource:

- Name: `ir35`
- Type/state: compartment / ACTIVE
- OCID: `ocid1.compartment.oc1..aaaaaaaa3k65nsyhjrq3gcjs5gvdvdnpdty3x4ktk6m3drs7dfgnsdmwh3nq`
- Existing budget/alert retained unchanged. No VM IP or capacity attempt exists.

## Correct policy and definition evidence

Live `limits definition list` returned exactly one matching supported, AD-scoped definition for each row:

| Quota family | Name | Value | Source |
| --- | --- | --- | --- |
| compute-core | standard-a1-core-count | 2 | [Oracle Compute Quotas](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/resourcequotas_topic-Compute_Quotas.htm) |
| compute-memory | standard-a1-memory-count | 12 | Same Compute documentation |
| block-storage | total-storage-gb | 150 | [Oracle Block Volume Quotas](https://docs.oracle.com/en-us/iaas/Content/Quotas/Concepts/resourcequotas_topic-Block_Volume_Quotas.htm) |

No name substitution was necessary. The approved policy is `ir35-always-free-cap`, description `Cap ir35 to Always Free envelope`, **stored at the tenancy root**, with the owner's exact three statements targeting compartmentir35. The adapter now builds that specification; no other quota statements are silently added. [Official CLI namespace](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/limits/quota/create.html).

AD-scoped quotas are not a tenancy-wide aggregate cap. Keep the independent pre-create2OCPU/12GB/150GB, five-volume-backup and8GB Standard Object Storage guards. Root policy placement does not turn these names into regional quotas, and higher trial limits/credits are not free entitlement.

## What changed / stop record

- Pinned CLI dynamically loads a service from **process sys.argv at import time**, not Click's later `args`. The prior probe imported it while argv contained `--payload-wiring`; quota service registration never happened. The new child process sets the exact service argv **before vendor import**, then retains the intercepted-client assertion. Namespace and credential assertions were not skipped/weakened. Actual routine CLI processes already use the real command argv.
- Unit regressions require root placement, exact policy name/description/statements, `limits quota` for create/get/list (including the read-only client's actual root list), supported definition names/scopes, correct child effective-limit reads and hard timeout with no create retry.
- Guarded bootstrap requires an owner600, current-source-hash-bound actual vendor-parser PASS receipt. No blanket removal of verification gates. Existing secrets remain outside Git.
- Exactly one compartment create was issued after fresh free/account/storage/budget checks and a durable intent. Its response ID was saved **before** the independent GET returned404. Initial generic error wording did not distinguish create from readback; the journal resolved that ambiguity. Read-only list found one matching name/intent; a subsequent single GET proved ACTIVE. Journal now records the verified resource and reconciliation, without repeating create.
- **Stopped provisioning per owner's new one-stop rule.** Do not restart the create, clear/reset its intent history, grant broader IAM or use the API key. No remaining permission problem is established by the transient initial readback. The quota's real CLI create was not attempted, so the conditional Terraform quota fallback is not applicable yet.
- Next authorized continuation can reuse this independently verified compartment, refresh per-create evidence, create the approved root quota once, list/get at root and poll effective child/selected-AD limits for up to10minutes. The bounded propagation wait is implemented/tested, but its live execution has not occurred. No launch before that PASS. A new failure stops; no Console or retry loop.
