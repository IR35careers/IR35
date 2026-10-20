# P1 draft: safe Oracle tooling/key gate and bounded capacity retries

## What and why

**Current status: P1 HELD, no resources created.** Authenticated audit and SSH-agent load verified, snapshot in docs/evidence/oracle-p1-resource-inventory.json.50Linux unit tests/types/32capacity tests pass before final hold regression; actual additional installed-CLI quota wiring test fails NoSuchCommand before any client/cloud call. Two failures plus one isolated-parser repair still FAIL, so stopped per owner rule. Prototype compartment/quota entrypoint is explicitly disabled; no live executor, createdOCIDs, capacity attempt, phasePASS or production change. Proposed next fix is vendor sys.argv/dynamic-loader alignment, not skipping tests. Full failure/evidence is docs/evidence/oracle-p1-storage.md. Do not interpret green generic CI as this local P1 gate passing.

Latest owner amendment: routine OCI now uses browser SecurityToken profile ir35, active-operation pre-expiry refresh with original24h limit, no API passphrase/env/fallback; batch owner gates per phase. Actual browser login plus safe session check PASS. Native Windows parent/private pipe repaired disabled WSL Windows interop after two failures; existing encrypted keys unchanged. Old API launcher retired. Storage guard/docs separate150GB live, five backups and8GB Standard-only objects (trial Standard10GB); prospective checks never claim actual billing/create PASS.41Linux tests plus two installed-CLI wiring tests pass. Current signed resource reconciliation is pending; no resource create or production change. New source requires its own hosted checks.

Starts P1 under the owner's final migration order, stacked on the P0 inventory/plan PR #47. This is **not a completed provisioning phase or a release**. Preserves the original dirty checkout and separate validator PR #48.

- Repaired the pinned OCI CLI in isolated WSL2 Ubuntu24.04, avoiding Windows MAX_PATH; no cloud request or resource create.
- Added a local TTY-only G1 helper for new encrypted SSH Ed25519/API RSA3072 keys, no passphrase arguments/pipes/logs, no overwrite or old-key revocation, 700/600 owner permissions and real crypto round-trip tests. Public uploads happen later, never private material.
- Limited durable capacity state to initial launch plus three proven-capacity retries. Unknown calls remain pending for reconciliation, not blind retries. This remains a pure state engine, not a live create adapter.
- Recorded final phase order/owner gates/full zero-loss standard without marking unexecuted phases PASS. Added free public-repo-only read-only CI for key tests, state ignores and encrypted-private-key source scanning.

## Risk

Sensitive local key handling and future infrastructure. No application behaviour, CSP/RLS, DB migration, production env/DNS, provider, queue/worker acceptance or release changes. No private keys/secrets/state in source/artifacts; test keys are disposable local fixtures. Existing £1 budget is historical, not duplicated. Do not use the older offline SSH-only provisioning plan as an approved whole-stack executor.

## Test plan

1. On Linux/WSL2, create an isolated venv and install `infra/oracle/key-requirements.txt`. Run `python -m unittest discover -s infra/oracle/tests -v`: actual encrypted-key round trip, wrong/no-password refusal, safe permissions, non-TTY/argument refusal, existing-file/symlink/shared-parent refusal and redacted errors must pass. No owner secret is used in tests.
2. Run `node node_modules/vitest/vitest.mjs run tests/unit/oracle-provisioning.test.ts`: four total capacity attempts, no fifth call, persisted count, strict plan/hash/AD validation and unknown-outcome reconciliation.
3. Run `npm run verify:release`, `npm run security:source`, dependency audit and parse the modified workflow. Check final-head CI separately; a local PASS is not a hosted result.
4. Owner G1: use only the dedicated hidden local terminal, both new passphrases twice, save encrypted keys/passphrases in password manager. Read only status/public fingerprint after completion; no screenshot, terminal transcript or private-key display. Then run live account/Always Free checks before **each** resource create and record evidence. No creation is claimed by these tests.

Preview URL / screenshots: not applicable to local infrastructure tooling; do not start or test production as a substitute. Any later web/auth/apply check uses only `anvesh.mannuru+ir35test@gmail.com` and mock ATS on protected staging. Production verification waits for its own phase gates and exact YES CUTOVER.

## Migrations / env vars / manual steps

No migrations or new app env vars. G1 owner hidden passphrase entry; G2 if public API-key upload requires console login/MFA. G3 Auth settings, G4 Google, G5 DNS and G6 exact YES CUTOVER remain later gates. Vercel, Supabase, DNS, Stripe and mail settings unchanged. Never merge, auto-merge, publish a production image, deploy production or enable a real worker from this PR.

See `docs/evidence/oracle-p1-tooling.md` for actual local results and explicit outstanding gates. P1 remains DRAFT/INCOMPLETE until guarded provisioning and read-back evidence pass.

## G2 complete / read-only resource reconciliation

Owner Console login now verifies tenancy/London, actual A1 **Always Free-eligible** at2OCPU/12GB and free Ubuntu24.04/A1 compatibility. AD-1 usage0; larger trial quotas are not the free allowance. Gross boot estimator£1.60/month excludes tier pricing, so cost/tenancy-wide usage is not passed. No launch/Create/Upgrade. New `resource_audit.py`/hidden launcher expose exact read-only operations only, all compartments/ADs, conservative allocation counts, budget+alert/bucket/cost read-back, strict metadata/error redaction, bounded no-retry calls and no generic/mutating CLI escape. Existing encrypted API key required; no regeneration/unencrypted fallback or retained passphrase from the earlier authentication helper. No new app environment variables/migrations. **30 Linux tests pass**; actual resource audit awaits owner hidden input; final-head CI remains required. [Console evidence](evidence/oracle-p1-console.md). P1 is still incomplete, not a deployed/migrated application.

## G1 follow-up

Owner completed key creation; encrypted-file mode/round-trip metadata verified. Fresh signed account/region/ACTIVE FREE_TRIAL checks and actual two-of-three key usage preceded **one requested public-key upload**. Durable intent was persisted first, independent ACTIVE read-back passed, old registered key remains and three total keys are now present. No private upload, key revoke, policy/user/plan upgrade, VM/network/volume/bucket creation or production mutation. The earlier no-cloud-call preparation bullets describe the first commit only. New narrow bootstrap/registration/unlock helpers have **22 passing Linux tests**, including unknown-outcome no-retry and error redaction. The next hidden prompt unlocks the existing API key once for read-only signed authentication, not another generation. New-head hosted checks are required; earlier release results are not claimed as final-head tests for the new helpers.

## Authentication verified / G2 handoff

New encrypted-key authentication receipt at20October03:36:29UTC is PASS; owner/ACTIVE Free Trial/London/new key ACTIVE/old key present, no writes. All10hosted checks passed at a2f438a for the helper source. Current docs-only update records that result without implying a VM/usage/cost/host-health PASS. Public-page browser navigation failed with geometry and concurrent-input errors; a documented connector repair has no Oracle session. Computer-use recovery stops further UI retries. Owner must sign in/MFA themselves in the normal headed browser on this computer, leave London Console home visible and reply **Console ready**. No authentication field, screenshot of credentials/MFA, new browser workaround, Upgrade or resource creation. P1 remains incomplete until current per-create eligibility/usage/journal/read-back evidence passes. No new unlock or key generation requested at this G2 checkpoint.
