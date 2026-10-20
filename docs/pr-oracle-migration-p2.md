# Oracle P2 — staging host hardening (draft, not production)

## What and why

Stacked on P1 draft49, not merged. Adds fixed staged Ubuntu24.04 ARM hardening with durable three-attempt ceilings, P1/target/mount/OCI-network prerequisites and pinned SSH. Non-root ir35 has key-only login, no sudo/Docker group; root/password login disabled. Exact owner/Bastion /32 SSH plus public80/443, ufw/fail2ban, unattended security updates without automatic reboot, UTC/chrony, 4GiB swap/swappiness10. Official signed Docker apt repo/Compose, data-root on the existing UUID data volume, mount-fail-closed systemd guard, rotated logs and DOCKER-USER WAN-port protection. No app, image publication, updater, database or consumer deployed.

## Current checkpoint and risk

Audit/install/configure and independent effective host/new-user verification PASS. First fresh SSH verify hit the platform INPUT rejection: removing its broad SSH exception exposed the image's terminal REJECT before UFW hooks. This was our helper ordering bug, not an OCI key/capacity failure. Owner source unchanged, OCI exact restricted ingress independently verified. One journalled existing-VM SOFTRESET loaded the already-written source-restricted persistent rules; changed boot ID and pinned fresh SSH PASS, **no IAM or broader ingress**. The UFW-first hook/systemd repair now passes with separate IPv4/ufw6 chain names. Owner completed one genuinely needed browser login. Repeated OpenSSH AllowUsers/native swapon readout fixes preserve strict assertions. No repeat reboot, generic firewall reset or insecure SSH fallback. Unused rpcbind disabled only after proving no NFS mounts or other port111 process.

The hook now runs before removing broad SSH on a fresh setup, and persists across UFW service restarts. Original configuration backups stay root600 on the VM; unrelated image rules are preserved. Docker group access is root-equivalent, so it is deliberately not granted. Changes affect only the staging VM. No RLS/CSP/schema, production env/data/providers, DNS, SMTP, worker flags, cutover or billing/paid-plan change.

## Test plan

1. Linux: `python -m unittest discover -s infra/oracle/tests -v`. Validate public-only input, /32 boundaries, exact UUID/no-mount guard, safe persistent rule replacement/idempotency, UFW-first hook, original-port Docker guard, no-root pinned SSH and durable max-three attempts. All test keys/addresses are fixtures.
2. Review `docs/evidence/oracle-p2-hardening.md` and the metadata JSON. Actual root checks and a fresh ir35 login passed; local tests are separate evidence. Linux unit suite:138 PASS.
3. Inspect the durable execution journal and public attempts; do not rerun already-completed configuration/reboot/repair stages or reset counters. `verify-exposure` adds an external SSH-positive/private-port-negative control. Never exceed three attempts, retry a data/identity mismatch or create a replacement VM.
4. Effective SSH root/password off; UFW first INPUT hook; exact owner/Bastion SSH; no global/v6 SSH; fail2ban active; 4GiB swap/swappiness10; UTC/NTP; Docker/Compose/mount/log guards; no unexpected public listener. Actual fresh ir35 login must have nonzero UID, ir35-only groups, no passwordless sudo or Docker socket write.

Preview/screenshots: not applicable to OS hardening; no private/auth screenshots. Later UI checks use protected staging, test account anvesh.mannuru+ir35test@gmail.com and mock ATS only. Production verification waits for full staging and exact YES CUTOVER.

## Migrations, env names and manual steps

No DB migration, app env file/value, registry token, DNS, Google, Supabase, Stripe or mail change. No remaining P2 owner action; no API/SSH passphrase. No merge/approval/auto-merge/PR closure/production deployment. P3 begins only after an evidenced P2 PASS.
