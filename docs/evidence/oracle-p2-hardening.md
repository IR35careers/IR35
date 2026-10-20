# P2 staging hardening — PASS, 20 October 2026

P1 passed with fifteen independently verified resources; its original IDs, 2OCPU/12GB/150GB envelope and exact-source network are retained. P2 creates no OCI resource and changes no production configuration/data/provider. Target: existing London Ubuntu24.04 ARM VM; no app/database/image/worker deployment or real employer interaction.

| Check | Actual result |
| --- | --- |
| P1 completion/target/network/exact data UUID prerequisites | PASS |
| Existing-host audit | PASS; Docker absent, no pre-existing deployment config |
| Official signed Docker/Compose and hardening package install | PASS |
| Account, SSH, ufw, fail2ban, updates, swap, Docker configuration command | PASS, independently verified effective controls |
| First fresh SSH verify | FAIL transport, attempt retained |
| Source IP / OCI security rule change | None; source unchanged, restricted rule read-backs PASS |
| Controlled recovery reboot | PASS, one action only; bootID changed, pinned fresh SSH restored |
| UFW-first hook repair | PASS; correct v4 and ufw6 chain names, no broad SSH |
| Effective privileged verification / fresh nonroot login | PASS; ir35 UID1002, ir35-only group, no sudo or Docker socket write |
| Docker / Compose | 29.9.1 / 5.6.0; exact data UUID, fail-closed mount guard, json-file 10m ×3 |
| Swap / time / security services | 4GiB, swappiness10, UTC/NTP; docker/fail2ban/unattended-upgrades/chrony active |
| Unused image RPC service | No NFS mounts, port111 exclusively rpcbind; disabled and listener absent |
| Host TCP listener inventory | Only22; no app/database deployed |
| External exposure (positive SSH control) | PASS;111/2375/2376/3000/5432/8000/8001/8025/8080/8443/9090/1025 unreachable |

Our first helper removed the image's broad SSH ACCEPT at runtime while its terminal INPUT rejection remained ahead of UFW. Persistent source-restricted rules had already been written; one existing-VM SOFTRESET loaded those and restored pinned SSH without IAM changes or wider SSH. The updated helper puts UFW's before-input chain first **before** removing broad platform SSH, preserving fail2ban/user rules and a systemd restart hook. No global firewall flush, root-key change or repeated reboot. Effective chain read-back now passes. One owner browser login followed a genuinely failed token refresh; it completed, with no API/SSH passphrase requested.

Readout corrections were tested against native output: OpenSSH repeats AllowUsers lines, ip6tables uses ufw6-before-input, and swapon uses its installed text-column interface rather than unsupported JSON. No assertions or security expectations were relaxed. Durable attempt counts remain in the [metadata report](oracle-p2-hardening.json); verify and firewall-order repair passed on their third execution, not a reset counter. The unused RPC removal and external exposure check passed once each and changed no data. Linux unit suite: **138 PASS**; installed-CLI wiring results are recorded below before publication.

Private attempt journal, public source inputs and original host-file backups remain outside Git (root700/600 or owner600 as applicable). No passwords/private keys/OTP/production env were transferred. Docker group membership is deliberately withheld from ir35; future privileged deployment stays with the existing owner administration account. Pinned `StrictHostKeyChecking=yes` remains required for ubuntu and ir35.

References: [Docker official Ubuntu install](https://docs.docker.com/engine/install/ubuntu/), [DOCKER-USER firewall processing](https://docs.docker.com/engine/network/firewall-iptables/), [Ubuntu firewall guidance](https://ubuntu.com/server/docs/how-to/security/firewalls/). UFW alone is not assumed to secure Docker-published ports; the separate original-destination-port guard is read back. Effective controls, NTP, private listeners and new-account SSH were checked independently of configuration success.

No remaining P2 credential gate. P3 starts after final P2 publication, with native ARM Postgres extension compatibility first. DNS, private Auth exports, Caddy runtime-secret custody and later Google changes remain explicit owner gates when needed. No real-time £0 bill guarantee or hosted CI PASS is inferred.

Final offline verification: **138 Linux unit tests PASS**, six installed OCI CLI parser/adapter suites PASS (99.359s; cloud clients intercepted, including SOFTRESET command wiring). Whitespace and source/history secret checks PASS (813 tracked files). No assertions/timeouts skipped or weakened; this is not hosted CI or database migration evidence.
