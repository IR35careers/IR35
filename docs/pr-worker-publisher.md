# Signed ARM image publication preparation

## What and why

Prepare the owner's zero-budget outbound update source. The disabled-by-default workflow runs only for this public repository's main, after a successful Release quality push. The actual publisher independently requires successful Release quality, native ARM and CodeQL push runs for the exact current main commit. It builds ARM with a commit label, checks the actual image's isolated browser/mock receipt, publishes a full SHA tag, signs the Docker-acknowledged immutable digest with keyless cosign, verifies exact workflow identity/issuer/ref/repository/SHA annotations, and copies that same digest to main. Existing unsigned/conflicting tags stop rather than being overwritten/re-signed; a tag substituted after push cannot select a different artifact for signing.

Exact production workflow identity: https://github.com/IR35careers/IR35/.github/workflows/worker-publish.yml@refs/heads/main; issuer https://token.actions.githubusercontent.com. No ignore-tlog, insecure certificate or wildcard-identity switches. Official actions and cosign version are pinned. No SSH to the VM, OCI credentials, self-hosted runner, application env or candidate data enters the publication job.

The host registry helper validates a classic VM PAT's reported scope as exactly read:packages and checks its owner. Fixed-host bounded HTTP rejects redirects/auth failures/malformed responses; only authenticated manifest 404 means absent. Actual private VM credential files and updater installation are still unfinished. CI uses its own short-lived GITHUB_TOKEN, not a VM PAT.

## Verification and limits

49 focused tests cover real orchestration with injected external effects, immutable push acknowledgement, tag races/substitution, unsigned/failed verification, wrong architecture, failed gates/sign/push, reruns, scope/owner rejection, fixed host/schema/body bounds and subprocess stdin/env/log redaction. These do not claim cryptographic signing or a live registry result. Final-head native ARM and actual signing remain required; ARM CI installs the pinned verified cosign release and checks the actual flags without registry writes. No UI change; screenshots not applicable. No baseline, timeout or assertion waiver.

Final local release: **881 unit tests/136 files + 199 legacy checks, TypeScript and ESLint pass**; both workflows parse as YAML. GitHub's official context reference confirms the corrected runner-step initialization. Final-head CI and actual signing remain required. No dependency/migration or new advisory exception.

Source/history check passes for 702 tracked files; dependency audit allows only the two existing exact owner-approved exceptions expiring 29 October. The actual CLI rejects an isolated non-Actions context before external work. Authenticated GitHub variable read-back confirms ORACLE_WORKER_PUBLISH_ENABLED is absent; no enabled publisher is inferred from preparation.

## Migrations, environment and manual gates

No dependency, migration, RLS, CSP or worker cutover change. New repository variable ORACLE_WORKER_PUBLISH_ENABLED defaults absent/disabled. The agent must verify actual account/free-policy/registry/standby gates before setting it. CI-only names SOURCE_SHA, GHCR_TOKEN (automatic GITHUB_TOKEN), GITHUB_ACTOR, GITHUB_OUTPUT, DOCKER_CONFIG and GitHub Actions OIDC variables must never go into the worker's raw .env. Docker auth directory is mode 700/config mode 600; login uses stdin, logs suppress credential-bearing subprocess diagnostics. No token is supplied or stored by this PR.

Preserves the owner's latest signup pauses and approval of only the exact private Bastion /32 SSH exception; actual security list/NSG/UFW inspection must prove no unrestricted SSH. No resources are created. Account activation, worker secrets, host updater with exclusive journal/drain/rollback, five-minute timer, external heartbeat, migration 025-compatible release and all real staging gates remain unfinished. No signed image, host update, real employer action or billing result is claimed.

## Safe production verification

Do not enable the prepared publisher from a merge alone. After actual free-resource and Oracle standby verification, the agent enables only image publication, then verifies actual native ARM signing/digest/identity/tag visibility with the read-only VM token. Run only the isolated mock ATS and named test account anvesh.mannuru+ir35test@gmail.com. APPLICATION_WORKER_ACCEPT_JOBS remains false and APPLY_RUNNER remains vercel. Literal YES CUTOVER is still required for either production selection or acceptance change.
