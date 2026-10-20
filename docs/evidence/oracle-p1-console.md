# P1 authenticated Console checkpoint — 20 October 2026

Draft [PR#49](https://github.com/IR35careers/IR35/pull/49), still incomplete/unmerged. Owner completed G2 personally in the existing normal headed Brave browser. Read-only inspection/form selections only; no launch, resource Create, Upgrade, PAYG, agreement, DNS, old-stack or worker change. No credential/MFA screens captured or entered; no public screenshots/raw browser trees retained.

| Check | Observed result / boundary |
| --- | --- |
| Console identity/region | PASS: Home shows tenancy **Ir35careers**, **UK South (London)**; URL region uk-london-1. Signed ACTIVE/FREE_TRIAL proof remains the earlier03:36:29UTC receipt; recheck before creates. |
| Limits, Quotas and Usage | Compute, root compartment, AD-1: standard-a1-core-count **41 limit /0 used /41 available**; standard-a1-memory-count **277 /0 /277**. These are trial/service quotas, not the free entitlement or host capacity. Other ADs/compartments not inferred empty. |
| A1 shape label | PASS: actual authenticated selector/form shows **VM.Standard.A1.Flex — Always Free-eligible**. Selected only in an **unsubmitted** form: **2 OCPU /12GB**, 2Gbps; no burstable-performance selection. |
| Official image | PASS: Canonical Ubuntu24.04, publisher Oracle, **Free**, build **2026.09.18-0**. Compatibility table lists VM.Standard.A1.Flex under Always Free shapes, plus BM.Standard.A1.160 (not selected). No Marketplace/Ubuntu Pro image or bare-metal selection. Actual image OCID/architecture/readiness still requires CLI read-back. |
| Draft price estimate | **NOT a zero-cost PASS:** boot volume **£1.60/month**, estimated total £1.60/month. Oracle explicitly states that this estimate does not reflect tier-unit pricing. No storage configuration/launch submitted. Do not interpret the gross estimate as a confirmed charge or silently waive it as free. |
| Tenancy-wide zero-cost create gate | **NOT PASSED:** complete current all-compartment/all-AD allocation/volume/backup/Object Storage usage, currency/cost and existing budget/alert read-back, plus guarded journal/reconciliation, remain required. No create on the strength of a public free-tier page or one AD. |
| Actual infrastructure / production | **None created by this checkpoint**, zero capacity launches. No instance/publicIP/health result. Old Vercel/Supabase/DNS/secrets/runner settings unchanged. Prior IAM public-key registration remains the only earlier cloud write. |

After inspection the estimate was closed and the **unsubmitted form cancelled**. Fresh London Instances view, root compartment, showed **No items to display**. No live instance or resource was deleted; this is root-list evidence, not a substitute for the pending all-compartment audit.

Official documentation re-read this turn confirms the 2OCPU/12GB A1 allowance and 200GB aggregate boot/block home-region allowance. This supports the intended **50GB boot +100GB block** envelope; it does not replace current actual allocation/free-eligibility checks or establish billing £0. [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

## Read-only reconciliation tooling

`infra/oracle/resource_audit.py` exposes only fixed account/resource **read** operations through the installed OCI CLI. It enumerates the root plus all discovered active/non-deleted compartments and all three London ADs, conservatively counts stopped/terminating allocations, queries A1 availability, all boot/block volumes/backups, VCNs/quotas, compatible Ubuntu images, bucket size metadata, the **existing** budget/alert, and current-month lagging cost data. No raw metadata, object paths, secret values or error bodies in its report. The report deliberately retains `freeTierCreateGate=NOT_PASSED`; it is evidence for later guarded checks, not an infrastructure executor.

- No arbitrary CLI arguments/endpoint/debug options or create/update/delete methods; complete list pagination required, partial cost pagination stops.
- Existing encrypted API key only, owner hidden prompt; no new generation, revocation, unencrypted fallback or passphrase retention from the previous one-shot unlock. Passphrase is in process/child memory only, never config/arguments/disk/logs.
- All inherited OCI overrides stripped; fixed London profile, no retry, bounded response/timeouts; unknown/incomplete metadata stops rather than becoming an empty/free inventory.
- Credits are reported separately from positive costs. Approximate bucket bytes and lagging/empty cost results never become exact usage or real-time billing-zero proof. No budget duplication or alteration.
- Owner-only metadata receipt outside Git: `/home/anvesh/.ir35/keys/oracle-migration-20261020/resource-audit-status.json`, mode600. The audit has **not run against the account yet**.
- One local help lookup used the unsupported root `budgets alert-rule` namespace. Installed CLI group help identified `budgets budget alert-rule` and `budgets budget budget`; command builders/tests were corrected **before authentication/resource calls**, no retry loop or cloud failure.

Actual local verification: **30 Linux tests PASS**, including8 new inventory cases (scope escapes/redaction/pagination/completeness/all compartments+ADs/stopped resources/cost-credit separation). Existing22 include encrypted-key/hidden-PTY input proof. All10hosted checks SUCCESS at prior **03b5c5fb19b58e7d82ba311f965e8c013eccca2b**; the new source requires fresh final-head CI, not inferred from that result.

Strict TypeScript, the PowerShell launcher syntax parser, source/history scan (**765 tracked files**) and diff checks pass. Static Vercel main/Oracle-branch deployment holds read back false/disabled. The copied public Python helpers match the tested source by SHA256 in the owner700 short-path tooling directory; no private key was copied or read into tool output. No full app/build/provider/Oracle runtime result is inferred from these local checks.

## Next owner-only credential handoff

The earlier authentication helper intentionally discarded its passphrase, so Console login does not unlock CLI signing. Use the dedicated **IR35 P1 read-only resource audit (G1)** terminal: enter the **existing OCI API passphrase once** (not SSH, not a new key), then tell Codex **Resource audit done**. Do not send the passphrase in chat. This process makes only read-only calls and cannot create a VM or change production. If it reports STOP, do not rerun/delete keys; report that status for bounded diagnosis.
