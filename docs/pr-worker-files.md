# Linux updater storage prerequisite

## What and why

Add the host's private configuration/state adapter before implementing automatic replacement. It rejects non-Linux hosts instead of treating Windows chmod as mode-600 protection. On Linux it requires an owner-controlled non-group-writable/private directory, regular owner-owned single-link mode-600 files and O_NOFOLLOW bounded reads; symlinks/hardlinks/permission drift fail closed. No shell evaluation, interpolation or quote stripping of raw worker values. Duplicate/noncanonical environment keys and a persistent startup-operation override are rejected.

The reviewed loopback-only Compose policy is canonical-JSON hash-bound to its source regression. Replacement accepts only this worker's immutable GHCR digest and changes only the image line, preserving every other deploy.env byte, both cutover settings and the entire raw worker env. Rechecks detect configuration edits before rename. Unique owner-only temp files are fsynced, renamed and the directory fsynced; failures require reconciliation, not blind retry. Operational writes cannot target the raw secret file. The temporary Compose override contains only startup UUID and a non-secret operation label, not acceptance/runner settings.

## Verification and limits

16 focused tests pass locally, including literal/CRLF preservation, unsafe/shell-like/mutable input, raw quotes/dollars, duplicate/bootstrap secrets, unchanged cutover data, exact Compose policy and override scope. Local Windows tests verify refusal of host operations. The same test cases execute actual POSIX I/O on Linux CI: atomic update/state modes, owner edit just before rename, no temporary residue, unchanged raw secrets/flags and unsafe mode/link/Compose rejection. Those actual Linux results are still pending; local passing counts do not prove POSIX behaviour. No tests skipped. No UI change or screenshot requirement. Full/source/CI final checks remain required.

Final local combined source passes **897 unit tests/137 files + 199 legacy checks, TypeScript and ESLint**, including strict override/host-token segregation regressions. Final source and Linux CI remain required.

This is a dormant storage module, not an installed/running updater. A shared exclusive flock for updater **and operator configuration edits**, durable transaction journal, signed pull orchestration, ten-minute drain/two-minute health/rollback recovery, install/service/timer and actual standby verification remain required before use. Rechecks do not claim atomic cross-file CAS against a malicious same-UID/root writer; those principals can control Docker already. No live private files, image selection or live env were changed by this PR.

## Migrations, environment and manual steps

No dependency, migration, RLS/CSP, new env setting, CLI installation or hosted change. No OCI/Railway resource or registry publication. The normal headed signup handoff remains with the owner, then literal Oracle account active before OCI setup. Bootstrapping automatic updates will require an actually signed GHCR current/previous digest, not a local-only image ID, plus owner-only `/opt/ir35-worker` files and actual free eligibility.

Production verification uses only mock ATS and anvesh.mannuru+ir35test@gmail.com after actual standby/credentials/free gates. APPLY_RUNNER=vercel and APPLICATION_WORKER_ACCEPT_JOBS=false stay unchanged. No YES CUTOVER was received. No full updater or deployment completion is claimed by this prerequisite.
