# Oracle account preflight — historical evidence, 19 October 2026

These authenticated checks were completed **before the new P0 inventory task**. No OCI resource or setting was changed during P0. Recheck eligibility and usage before P1; these results are not a deployment approval.

- Official OCI CLI 3.95.0 / SDK 2.188.0 are installed outside Git. Registered key authentication, matching tenancy/user identifiers and ACTIVE user were verified without printing private material. Local OCI files have owner/SYSTEM-only ACLs.
- Tenancy Ir35careers: sole subscribed region **uk-london-1 / LHR**, READY and home region. Subscription ACTIVE, **FREE_TRIAL / FREE_AND_TRIAL**, currency **GBP**; no PAYG upgrade.
- At that check there were no child compartments, non-terminated VMs, boot/block volumes, volume backups or VCNs. All three London ADs were inventoried. This was not an inventory of every OCI service.
- A1 regional quota showed 16 available OCPUs / 96 GB, zero used; AD-1/AD-3 advertised A1 limits and AD-2 zero. **Trial quotas are not Always Free entitlements or host capacity.**
- Public A1-compatible image candidate: `Canonical-Ubuntu-24.04-aarch64-2026.09.18-0`, AVAILABLE. No instance was launched.
- DAILY cost report for 1 October–19 October 00:00 UTC returned no rows. Reporting can lag; this is not a real-time £0 invoice/balance guarantee.
- After the owner's explicit GBP approval, budget `ir35careers-free-tier-gbp1` (£1 monthly) and ACTUAL/100% alert `ir35careers-gbp1-actual` to **info@ir35careers.com** were created and independently read back ACTIVE. No email delivery test. A budget is not a spending cap or permission to spend £1.

No VM, public VM IP, network, SSH deployment key, registry publication, updater or worker installation was created by those checks. No production setting, DNS, database migration or cutover changed. Private keys and raw configuration remain outside this public repository; public account OCIDs are deliberately omitted here.

Current requirements and blockers are in [the superseding whole-stack migration plan](oracle-migration-plan.md). The owner resolved the size conflict: **2 OCPU/12 GB total**, 50 GB boot plus one 100 GB data volume, not the superseded larger trial-sized proposal. Verify current tenancy-wide usage and actual Always Free eligibility before every create; higher trial quota is not permission. [Oracle Always Free documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
