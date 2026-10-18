# Offline Oracle provisioning plan and bounded capacity retries

## What and why

Prepare the fixed zero-budget London A1 resource plan and safe retry state, independently of account activation. Runtime PR #28 is merged after all 17 checks; this does not deploy it. The new CLI is explicitly offline-only: no cloud/API/credentials or apply option. Public config/cloud-init hash binds commands to one reviewed plan; wrong region/overrides/private keys/broad ingress/dependency IDs fail validation. Resources have ownership tags and collision detection. No inherited broad default security list.

Capacity state rotates inspected ADs every ten minutes for at most two hours, persists intent before a supplied launch call and never repeats an unknown launch outcome. A capacity rejection is distinct from timeout, authentication, quota and generic server errors. Tests use fictional public config and injected ports, never a live Oracle API or employer.

## Verification

- **45 focused provisioning/bootstrap tests** pass, exercising plan/arguments/bootstrap/network/retry/unknown outcomes/persistence ordering, actual filesystem CLI summary/rejection and no-apply CLI.
- Final local **783 unit tests/130 files + all 199 legacy checks, TypeScript/ESLint pass**. Source/history scan passes for 677 tracked files; dependency audit passes with only the existing two exact advisory exceptions expiring 29 October, no new exceptions. Final-head CI remains required.
- Screenshots: not applicable, no UI change. ARM Docker/browser/Postgres health is covered by unchanged native ARM CI; this PR does not claim new host health.
- Manual negative CLI invocation with `--apply` exits 1 without OCI calls. No actual public config, OCID, SSH key, journal or credentials committed.

## Scope and remaining manual steps

No migrations, RLS/CSP changes, new environment variables, account/plan changes or deployment. No production apply behavior changed. Main and Oracle preparation Vercel holds remain. Railway remains untouched/undeployed. Both acceptance/cutover gates unchanged; no literal YES CUTOVER received.

Owner Oracle activation is still pending. After native account/CLI login, the agent must verify actual Free Tier/non-PAYG and home region, official Ubuntu ARM image, zero charge estimate, usage/quotas across all compartments/ADs, budget and currency. The **live OCI execution adapter, exclusive atomic journal, resource read-back/reconciliation, provisioning and billing evidence are still required**; do not mistake pure plan/retry port tests for hosted completion. Automatic update SSH policy remains an unanswered owner choice.

Google Cloud provider branding/preview and compatible migration 025/web rollout remain separate gates. DNS/Stripe/Postmark/Supabase/Vercel settings are not changed here. No test-account or candidate records are touched. Future production verification remains restricted to mock ATS and `anvesh.mannuru+ir35test@gmail.com`, never a real employer.

## Rollback

Revert this preparation commit if necessary; it has no hosted side effects or data migration. Retain the already merged runtime standby flags. Production rollback remains `APPLY_RUNNER=vercel`; no worker acceptance has been enabled.
