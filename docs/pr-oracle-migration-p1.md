# P1 draft: safe Oracle tooling/key gate and bounded capacity retries

## What and why

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
