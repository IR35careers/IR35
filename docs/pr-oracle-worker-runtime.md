# Oracle Always Free runtime foundation — no deployment

## What / why

Owner changed the persistent host to Oracle Always Free A1 and zero budget. Add oracle as a pg-boss runner alias throughout web producers, residual Vercel forwarding, signed drain, claim guard and retry bounds. Keep railway as a code-compatibility alias only; do not deploy or delete its empty trial. Vercel remains the default. Standby now works with that unchanged selection and acceptance false; active queue consumption under Vercel selection is rejected.

Queue claims require the selected host identity, one preferred application ID and the existing no-reclaim-running guard; an older/unselected consumer cannot bypass it by using another prefix. Existing approvals, confirmed-email, idempotency, receipt, tenant and HMAC checks remain. No SQL/RLS/CSP change or customer data repair is included.

## Infrastructure assets

- Pinned multi-architecture Playwright 1.61.0 Noble index, matching playwright-core. Actual MCR metadata includes arm64; native ARM execution is an explicit CI gate.
- `infra/oracle/docker-compose.yml`: linux/arm64, unless-stopped, init, 4 GB, bounded PIDs/shared memory, dropped capabilities/no-new-privileges, 330s drain, rotated logs and **127.0.0.1-only health**.
- Raw worker secrets stay in `/opt/ir35-worker/.env` mode 600; separate non-secret `deploy.env` prevents interpolation of `$`/quotes in credentials. Both cutover flags remain unchanged by default.
- Validated cloud-init generator and Ubuntu24/arm64 host bootstrap: non-root deploy user, password/root SSH off, owner IPv4 /32 UFW, fail2ban, unattended upgrades, 2 GB swap and signed Docker/Compose packages. This only renders bootstrap configuration; it does not provision a VM or start work. Docker group access is explicitly root-equivalent.
- Useful six-hour mock-smoke service/timer: same pinned image, network none, no env/secrets/queue, one mock form receipt. It is **not** an idle-reclamation guarantee or artificial load.
- Standard public-repository native ARM CI: Docker build, architecture/Compose validation, isolated Chromium/mock ATS and real disposable Postgres queues/owner-producer permission probes/standby. No OCI secrets, VM, GHCR publication or auto-deployment. Remains a release gate if repository visibility changes; no paid runner fallback.

## Tests / evidence

Unit tests cover aliases/default/fail-closed configuration, per-host claims and running outcomes, native producer-only routing and authentication, cloud-init input/SSH boundaries, no bootstrap secrets, Compose limits/raw env and mock timer safety. Full results are recorded in `progress.md` after final verification.

Initial full check: **739 unit tests/128 files + all 199 legacy, types/lint**, followed by **12 passing new producer-route cases**. Production build and browser run: **12 passed, 12 existing platform-only skips**, with mock question bounds and submission boundary outcomes. Bash syntax checks pass. Local x64 real Chromium smoke reports exactly one mock receipt. Native ARM/actual Compose/Postgres CI is not claimed run yet; final-head CI must pass. No visual UI change, new baseline/skip or accessibility exemption; screenshots are not used as proof of hosting.

Final local source check: **751 unit tests/129 files, 199 legacy, TypeScript and ESLint pass**, including 52 focused Oracle/queue cases. Source/history scan passes (672 tracked files), workflow YAML and both Bash scripts parse. Dependency audit passes with only the two pre-existing exact exceptions expiring 29 October. The mock now refuses worker credentials; ARM CI will execute the real timer wrapper with an immutable local image and a deliberate raw-env fixture to detect leakage. No new security exception. Final-head CI remains required before merge.

## Environment / manual steps / open dependencies

Names/defaults and exact agent-run command inventory are in `deploy-worker.md`, root `.env.example` and `infra/oracle/deploy.env.example`. New non-secret name: `IR35_WORKER_IMAGE`; supported runner value: oracle. No real value is committed.

Owner Oracle activation is still unconfirmed; OCI CLI setup/API key upload, $1 alert (not a hard cap), actual free-eligibility/quota/region read-back, reproducible VCN/subnet/VM/capacity retries, queue roles, SSH key trust/secret transfer and hosted browser/database health remain required. Migration 025/compatible web rollout remains separate and pending. No credentials or external-resource success is fabricated.

Two gates are explicitly open: (1) owner-IP-only SSH versus GitHub-hosted SSH deploy networking, with owner choice requested before any firewall change; (2) standby heartbeat persistence/external >5-minute-stale alert without buying Vercel Cron. No self-hosted runner is installed on the public-repo candidate-data VM. Google consent preview still needs native owner sign-in and is not completed by these worker files.

## Release / rollback

No Oracle provisioning/deployment, Railway mutation, queue setup, application enqueue, provider/billing mutation or production flag change. Git deployment holds remain. Nothing is authorized to accept jobs until literal **YES CUTOVER**, then only the documented mock/test-account matrix and 30-minute observation. Keep the Vercel consumer for seven-day rollback; do not remove its trigger in this PR.

Rollback after a later approved cutover: stop new queue claims/let active work drain, inspect unknown outcomes/receipts, restore web **APPLY_RUNNER=vercel** and the reviewed web/previous image version. Do not delete queue/history or blindly replay employer outcomes. Verify hosted flows only with the approved test identity and mock ATS, never a real employer. No $0 billing result is claimed until read from the real account.
