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

## Guarded P1 start — local tool/key gate, no cloud calls

After the owner approved the P0 decisions and guarded P1, local checks found the installed OCI CLI 3.95.0 incomplete (`oci_cli.util` missing). One same-version reinstall into the existing isolated tool environment failed on a Windows long-path package filename. **Two failures: stop and report, no further repair loop or SDK substitution.** The earlier successful account evidence above is historical, not a fresh live eligibility result. No authenticated OCI request, capacity launch attempt, resource create or cost assertion was made during this P1 start. Three permitted capacity retries have not been consumed; this is a local tool failure, not OutOfHostCapacity.

The existing registered API private key is outside Git with owner/SYSTEM-only directory ACLs, but its PEM is **not passphrase-encrypted**. Its values were not printed. Before provisioning, preserve the registered RSA key/fingerprint and protect it through a hidden native passphrase prompt; never store the passphrase in config/env-on-disk/args/logs. OCI signing requires RSA; SSH uses a separate passphrase-protected Ed25519 key. Neither a replacement key nor a prompt was created while CLI recovery is blocked. Owner must retain recovery copies in the password manager; no private SSH/API/age key belongs on the VM.

Next local recovery should use a reviewed shorter installation path (same pinned CLI version), not enable global Windows policy or retry the failing long path. Resume only after reporting this gate, then repeat live account/home-region/usage/eligibility checks before any create. P1 remains incomplete: **created resource OCIDs: none**.
