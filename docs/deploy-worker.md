# Oracle Always Free worker — staged deployment runbook

18 October 2026 owner override: **zero budget**. Never upgrade Oracle to Pay As You Go, Railway, Supabase or another plan. Stop before a potentially chargeable action. Keep Railway's empty trial project/service intact and undeployed. The agent runs commands; the owner supplies only native logins/hidden secrets, dashboard-only approvals and final cutover. The [Railway command archive](deploy-worker-railway-archive.md) is withdrawn, not a deployment alternative.

No literal **YES CUTOVER** has been received. Both web and standby container retain `APPLY_RUNNER=vercel`; `APPLICATION_WORKER_ACCEPT_JOBS=false`. The standby queue process can validate Chromium/database health with those unchanged flags. It refuses consumption with the Vercel selection. Do not infer cutover approval from a successful build, account login, merge or healthy standby.

## Current evidence, not claims of deployment

- Supabase project `kxcbgflleqnjzjbkevwd`: CLI reports healthy **eu-west-2**. Closest geographical Oracle choice: **UK South (London), uk-london-1**, not a latency/capacity promise. Owner signup at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) is still unconfirmed. No OCI account/VM/public IP/billing result is claimed.
- Actual registry manifest for Playwright `v1.61.0-noble` includes linux/amd64 and linux/arm64. Dockerfile pins the multi-architecture index **sha256:57b65fdc9ceabe0ef613124c7bbe2babcf9362c4d85e382fe3b03604e84b428a**, matching playwright-core 1.61.0. ARM child digest **sha256:35488358a60d3e7eacc4f02e0985e3b46240424d6d7b229732332016e6127508**. A manifest is not a browser execution test.
- Native ARM CI builds the actual Dockerfile and runs an isolated mock ATS form/receipt on the standard `ubuntu-24.04-arm` runner. It uses no secrets, external network, Supabase or employer; no VM/registry deployment is included. This repository is PUBLIC; standard ARM runners are free for public repos. The new job is deliberately ineligible if repository visibility changes; ARM verification then remains a release gate, not silently proven.
- Backup is verified outside Git; see [pre-migration-backup.md](pre-migration-backup.md). Migration **024 installed**, effective private/browser ACLs verified, watchdog not invoked. **025 uninstalled**, held for compatible database/web rolling-client release. Queue owner/producer and hosted pg-boss setup are still pending. Never use blind `supabase db push`: legacy 001–023 history is not registered.
- Main/preparation Git deployment holds remain. Auth fixes through PR #27 are merged, not a production release. No consumer removal, job enqueue or acceptance setting is authorized here.

## 1. Account, CLI and budget — blocked on owner activation

Choose the commercial London home region carefully: Always Free compute is tied to the home region, which cannot be changed. A1 capacity is not guaranteed. Oracle may require a temporary card-verification hold, which it says is not a charge. Never select Upgrade/PAYG or use trial-only paid shapes as a fallback.

After the owner confirms account activation, the agent installs the official OCI CLI using an isolated user installation and runs `oci setup config`. The owner supplies tenancy/user OCIDs through the native prompt and approves adding the generated API **public** key in **Profile → My profile → API keys → Add API key → Paste public key**. API/SSH private keys stay outside Git with owner-only access. Never print a private key, token or credential response.

Create the requested **$1 monthly budget** at tenancy scope and an actual/forecast spend alert to the owner's confirmed email. A budget is **an alert, not a spending cap**; verify the billing currency and UI/API result. No budget is claimed created yet. Do not invent an email address or send the alert before the owner account is identified. No paid subscription or usage is needed to prepare code.

## 2. Provisioning gate and reproducibility

Required target: one **VM.Standard.A1.Flex, 2 OCPU, 12 GB RAM**, Ubuntu **24.04 aarch64**, **50 GB** boot volume, UK London. Verify the actual tenancy is Free Tier/non-PAYG, total existing usage/quota and that shape/image/storage are Always Free-eligible before creating anything. Current Oracle documentation lists 2 OCPU/12 GB-equivalent free A1 resources and 200 GB combined free boot/block storage; account-specific eligibility is authoritative. Stop on a charge estimate or uncertain eligibility.

Provisioning still needs an authenticated CLI/account; there is no pretend instance OCID or stub successful provisioner. The remaining reproducible provisioning command must create a VCN, internet gateway/route and public subnet, then a security list allowing inbound TCP **22 only from the owner's freshly verified public IPv4 /32**. No 80/443/8787, broad SSH or IPv6 ingress. Do not silently add SSH access for GitHub's runner ranges. Capture existing resource IDs and reuse only exact task-owned resources; retries must not duplicate VMs or recreate networks.

### Offline plan and capacity engine (prepared; not an execution driver)

`npm run worker:oracle:plan -- --config <outside-repo-public-config.json>` is an **agent-run offline inspection** command. It reads no env/OCI credentials, performs no network call, writes no files and offers **no `--apply` option**. It prints only a plan hash, fixed target, SSH scope, unchanged flags and explicit unmet prerequisites; it does not certify Always Free eligibility. Do not create an input from invented production IDs. After activation the agent will construct it from the inspected account:

| Public config field | Required source |
| --- | --- |
| `version` | 1 |
| `deploymentId` | One UUID persisted for this deployment/recovery; do not regenerate after an uncertain launch. |
| `tenancyId`, `compartmentId` | Real authenticated account; root tenancy is allowed as compartment. |
| `region` | uk-london-1 only. |
| `imageId` | Actual London official Canonical Ubuntu 24.04 ARM image, live compatibility and zero-cost image verification required separately. |
| `availabilityDomains` | Unique London AD names returned by this tenancy, not guessed prefixes. |
| `deployPublicKey`, `sshCidr` | Structurally valid Ed25519 **public** key and the owner's refreshed public IPv4 /32. No private key or secret accepted. |

`provision-plan.ts` constructs OCI **argument arrays**, not shell strings: VCN with IPv4 CIDR list/DNS and IPv6 off, gateway, a separate route table, separate SSH-only security list, regional public subnet using **only** that explicit list, then fixed A1/2 OCPU/12 GB/50 GB launch with IMDSv1 off and public cloud-init. All resources carry deployment/plan ownership tags; the tag/name matcher stops on collision/drift/duplicates. This matcher is not a substitute for reading back actual CIDRs, rules, routes, image/shape/volumes/VNICs. OCI's default security list is not attached to the subnet. Generic CLI retries are disabled so an SDK cannot silently retry an unknown create.

`capacity-retry.ts` is a tested state engine with injected persistence/launch ports, **not a running scheduler**. It permits up to 12 launches, one per ten-minute slot, round-robin across inspected ADs, within the original two-hour window. The intent must be durably persisted **before** the API call; completion/capacity result is persisted afterwards. A crash, transport error, missing response or failed completion write leaves the intent pending: stop mutations and reconcile the resource. An empty eventually-consistent list response is not proof the VM was not created. Only HTTP 500 `InternalError` with the documented exact “Out of host capacity” sentence permits a new attempt; different messages fail closed for inspection, never paid fallback.

**Remaining execution work:** install/setup CLI only after activation; capture actual free-tier/home-region/zero-charge/tenancy-wide quotas and budget evidence; hold an exclusive local lock and atomically persist the public journal outside Git; execute/read back/reuse one resource at a time; reconcile unknown network creates as well as instances; observe capacity waits in cancellable slices no longer than 30 seconds. Never reset the persisted deadline after restart, reuse a conflicting resource, or create a second deployment to evade an unknown outcome. Do not run generated create arrays manually around those gates. No live journal, resources or successful provision is claimed by the offline plan.

For `Out of host capacity` only: retry across returned availability domains every ten minutes for at most two hours. Re-read instance state/idempotency after unknown launch outcomes before retrying. A capacity retry is not authorization for a paid shape, larger volume or PAYG. Report other errors immediately and report the two-hour capacity limit honestly.

`infra/oracle/cloud-init.ts` renders `#cloud-config` using JSON (a YAML subset) from a structurally validated Ed25519 public key and one public IPv4 /32. It never provisions. It installs Docker Engine/Compose from Docker's signed Ubuntu repository, unattended upgrades, fail2ban and a 2 GB swap file; creates locked-password non-root **ir35deploy**; disables root/password SSH; and restricts host UFW to the same SSH source. Initial package setup happens before enabling Docker's apt source/key. It does not write worker secrets or start a worker. Ubuntu's default maintenance user remains for controlled host administration.

Docker group access is root-equivalent despite the non-root deploy account. Do not treat it as a sandbox for untrusted CI jobs. Never install a self-hosted Actions runner on this candidate-data VM for the public repository. Pin/check the SSH host key through trusted OCI console output before transferring secrets; never use `StrictHostKeyChecking=no` or accept an unverified `ssh-keyscan` result as proof.

## 3. Image, Compose and secrets

Build the same pinned Dockerfile for **linux/arm64** on the VM or use an approved free public GHCR build/publish. Native ARM CI is verification, not image publication. Do not invent `IR35_WORKER_IMAGE`: use the actual immutable local `sha256:...` image ID after a reviewed on-VM build, or the actual public GHCR `@sha256:...` digest after CI passes. Retain the preceding image for rollback. Before any first GHCR publication verify public visibility/free allowance; new packages can default private, so do not assume a free-public-image result from a public source repository.

Install these reviewed files on the VM only after the free-resource gate:

- `/opt/ir35-worker/docker-compose.yml` from `infra/oracle/docker-compose.yml` (JSON-style YAML).
- `/opt/ir35-worker/deploy.env` from `infra/oracle/deploy.env.example`: **non-secret interpolation only**, image digest and both unchanged flags. Protect it from unauthorized modification.
- `/opt/ir35-worker/.env`: raw one-line worker variables, owned by ir35deploy, **mode 600**, directory mode 750. Use SSH stdin from hidden prompts or a permitted private temporary Vercel export, normalize values in memory and delete that temporary file immediately. Never overwrite a pre-existing local env file. Never put secrets in SSH arguments, command output, Git or CI artifacts.

Use Compose **2.30+** for `env_file.format=raw`. Always use `--env-file deploy.env` for Compose interpolation; the raw secret-bearing `.env` is loaded only into the container. This preserves literal `$`/quotes in credentials and avoids Compose interpolation warnings leaking secret fragments. Do not paste a quoted Vercel export directly into the raw file: parse and normalize selected keys without logging them. Escape CA newlines as literal `\n`, which the queue config converts back to PEM.

Agent command inventory (not owner homework and not executed until the gates above):

```sh
cd /opt/ir35-worker
test "$(stat -c '%a' .env)" = 600
docker compose --env-file deploy.env -f docker-compose.yml config --quiet
docker compose --env-file deploy.env -f docker-compose.yml up -d --pull never
curl --fail --silent http://127.0.0.1:8787/health
```

Do not run bare `docker compose config` or `docker inspect` into shared logs: resolved environments contain secrets. Compose uses restart **unless-stopped**, 4 GB memory, bounded PIDs/shared memory, non-root image user, dropped capabilities, no-new-privileges, 330s graceful drain and three rotated 10 MB log files. Only **127.0.0.1:8787** is published; verify no public listener. `/health` must return HTTP 200 with **browserReady=true, databaseReady=true, mode=standby, active=0** through verified SSH. The current x64 mock test or ARM CI is not proof of that hosted database result.

The inventory assumes the reviewed image is already present. For a verified public GHCR digest, explicitly pull that digest before `up`; for an on-VM build, use `docker build --platform linux/arm64 -f services/application-worker/Dockerfile --iidfile /opt/ir35-worker/image.id .` from the reviewed source checkout, then set its actual ID privately in deploy.env. Never attempt a registry pull of a local-only image ID. The smoke wrapper accepts only a local immutable SHA256 ID or the reviewed project's pinned GHCR digest, not arbitrary mutable tags.

## 4. Queue and worker variables — names only

Root `.env.example` and `infra/oracle/deploy.env.example` contain no real credentials.

| Name | Use |
| --- | --- |
| `IR35_WORKER_IMAGE` | Non-secret deploy.env only, actual reviewed ARM image digest. |
| `APPLY_RUNNER` | Web/standby default vercel; oracle and legacy railway select the same pg-boss path only after YES CUTOVER. |
| `APPLICATION_WORKER_ACCEPT_JOBS` | false until approved cutover. Vercel selection + true is rejected. |
| `PG_BOSS_DATABASE_URL` | Worker owner login **ir35_queue.PROJECT_REF**; Vercel uses separate **ir35_queue_producer.PROJECT_REF**. Supabase session pooler host, **5432**, database postgres, URL-encoded password. Never transaction pooler 6543. |
| `PG_BOSS_SSL_CA` | Optional trusted CA PEM; certificate/hostname verification never disabled. |
| `APPLICATION_WORKER_SECRET` | Existing shared >=32-character signed claim/callback key; standby also validates its shape. |
| `IR35CAREERS_APP_URL` | Approved canonical HTTPS origin. |
| `APPLICATION_WORKER_CONCURRENCY`, `APPLICATION_WORKER_VERSION` | Initially one, private release diagnostic label. |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CRON_SECRET` | Active consumer only; not needed for standby queue/browser checks. URL is public; the keys are not. |
| `REED_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOB_DECIMAL_RATES_ENABLED` | Optional ingestion; absent sources are skipped, not fabricated. Decimal flag only with installed 023. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Optional existing evidence-safe mapper; not a replacement for the later OpenAI service. |
| `APPLICATION_RUNNER_ALLOWED_HOSTS`, `AUTO_APPLY_DAILY_BATCH_LIMIT` | Optional narrower destinations/scheduler limits; existing SSRF/approval/caps remain. |
| `PORT`, `NODE_ENV`, `PLAYWRIGHT_BROWSERS_PATH` | Container defaults 8787, production, /ms-playwright. |

`PG_BOSS_LOCAL_TEST` / `PG_BOSS_PRODUCER_TEST_DATABASE_URL` are **disposable CI only**, never hosted. No Stripe, Google OAuth, mail or anon key is added to make unrelated features appear configured. Legacy `railway.ts` / `enqueueRailwayApplication` names are compatibility entry points only; no Railway API is called. `worker:queue` is the host-neutral entry point.

Queue roles/setup remain agent-run after backup and hosted access: queue-only owner `ir35_queue` and separate producer `ir35_queue_producer`, both nonprivileged/no memberships/no BYPASSRLS, no candidate-schema access. Run `setup-queue.ts` as owner, then reviewed `supabase/operations/pgboss-producer-grants.sql` as owner; preserve private pgboss outside exposed Data API schemas. Runtime cannot migrate DDL. Seven queues: apply, ingest, enrich, match, tailor, mail, alerts. Current handlers consume apply/ingest/existing automation-on-alerts only. Do not publish unimplemented handlers. The destructive `verify-queue-permissions.ts` is for disposable loopback CI only, not the hosted customer database.

## 5. Useful smoke timer, monitoring and automatic updates

After image/standby verification, install `infra/oracle/run-smoke.sh` as `/usr/local/bin/ir35-worker-smoke` and the service/timer under `/etc/systemd/system/`. Enable with `systemctl enable --now ir35-worker-smoke.timer`; verify `list-timers` and one successful service run. It launches the same pinned image with **--network none**, no worker env/secrets and a loopback mock ATS. It fills a form and checks exactly one receipt. It cannot send real applications or change queue acceptance. This is useful browser-health work, not artificial load.

**No idle-reclamation guarantee:** a short six-hour smoke test does not ensure Oracle's seven-day 95th-percentile CPU/network/memory utilization thresholds. Do not generate fake load to evade policy. Keep image/config/infrastructure reproducible and secrets outside the boot volume backup; document restore/reprovisioning and A1 capacity risk.

**Open network decision:** requested owner-IP-only SSH conflicts with GitHub-hosted SSH deploys from a different IP. Owner choice requested: keep the rule and approve an outbound image-pull updater, or explicitly approve a temporary deploy-job /32 rule that is removed afterwards. No broad range, new firewall rule, self-hosted public-repo runner or live auto-deploy is implemented/enabled without that decision. The final deploy workflow is still required, not claimed replaced by the smoke timer.

**Open external uptime work:** the queue consumer currently writes heartbeat rows only while accepting jobs; standby persistence and an external stale-over-five-minute alert must still be implemented/tested. Vercel is currently **Hobby**; do not add an unsupported every-five-minute Vercel Cron or buy a plan. Preserve current daily crons, then prepare an approved free external schedule against the authenticated watchdog endpoint and document its actual alert latency. A five-minute staleness threshold is not a guarantee that a daily cron detects an outage within five minutes. No email/alert is claimed sent.

## 6. Staging, cutover and rollback

Before asking for cutover: actual Oracle SSH health above; current live queue roles/ACLs; compatible 025/web rollout; mock ATS duplicate/outage/restart/lost-ack/watchdog/cancellation/reload matrix and results table; external heartbeat/alert verification; preserved history/receipts. Use only the approved test identity and mocks, never a real employer. Google preview sign-in is a separate gate.

Only after literal **YES CUTOVER**: set web and container selection to oracle and worker acceptance true, drain residual Vercel deliveries into pg-boss, verify a mock receipt/reload and queued ingestion, then observe logs for 30 minutes. Keep the Vercel consumer/trigger for the seven-day rollback window. Its removal is a separate unmerged follow-up PR until that window ends.

Rollback: stop new queue claims by setting acceptance false, allow bounded active work to drain and inspect unknown outcomes/receipts; restore web `APPLY_RUNNER=vercel` and reviewed web version. Do not blindly replay unknown employer outcomes, delete queue/schema/history or run both schedulers. Retain the preceding image digest. Replay only still-queued IDs through existing idempotency/reconciliation after inspecting state.

Final report must include actual region, instance OCID/IP, names-only environment inventory, hosted test results, rollback evidence and **real $0 billing read-back**. None is inferred from this local preparation.

## Primary references

[Oracle Always Free/idle policy](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Free Tier account/card FAQ](https://www.oracle.com/cloud/free/faq/), [budgets](https://docs.oracle.com/en-us/iaas/Content/Billing/Tasks/create-budget.htm), [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/), [Compose services/raw env/resource/port options](https://docs.docker.com/reference/compose-file/services/), [Playwright Docker](https://playwright.dev/docs/docker), [GitHub standard runners/free public ARM](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [GitHub public-repo self-hosted security warning](https://docs.github.com/en/actions/reference/security/secure-use), [Supabase session pooling](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).

CLI command options are checked against the official references: [VCN create](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/network/vcn/create.html), [subnet create](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/network/subnet/create.html), [security list create](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/network/security-list/create.html), [route table create](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/network/route-table/create.html), [gateway create](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/network/internet-gateway/create.html), [instance launch](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/compute/instance/launch.html), [Compute capacity error](https://docs.oracle.com/en-us/iaas/Content/Compute/known-issues.htm). Generated arrays have not been executed against an OCI tenancy; exact installed CLI/API compatibility is a later live gate.
