# Worker update crash journal

## What and why

Add the write-ahead transaction core for the owner-approved signed pull updater. Every decision is persisted before its external stop, replace or resume action. Drain, candidate boot and rollback boot have distinct UUIDs; fresh proof must match the actual immutable image, boot generation, mode, configuration fingerprint and maintenance operation. Both callback activity and database submitting counts must be zero before replacement. Standby cannot report consuming work.

The original ten-minute drain deadline survives retries/reloads. Candidate and rollback health have two-minute deadlines. Lost command acknowledgements retain the recorded intent, permit only same-operation replay against a fresh physical observation and never blindly repeat Compose replacement. If a durable write succeeds but loses its acknowledgement, the in-memory writer is unusable until reloaded. The class returns no private exception details.

The candidate's resume decision is itself durable before sending resume. Recovery must not kill or roll back that possibly consuming generation: an employer submission may already exist. Before resume, failed candidate health may restore the preceding verified image under a separate rollback generation. Confirmed rollback records the rejected digest so the next timer does not repeatedly deploy it. Known committed paused container restarts may resume only that exact generation without an image or cutover change.

## Verification and remaining work

21 focused Vitest cases pass, covering successful commit with a legitimately active post-resume consumer, storage/HTTP acknowledgement loss, cold reload, wrong/stale/busy proof, clocks/deadlines, healthy rollback, rejected digest, unknown activation outcome and restart recovery. These are isolated data/callback tests, not a real Docker or Oracle update. No environment acceptance flag is enabled by a consumer-mode fixture. Full release/source/audit and exact-head CI are still required.

This core requires a single serial writer under a shared Linux flock. The actual host interpreter still must validate signatures/current and previous artifacts, reconcile Docker identity/health after crashes, preserve literal config, execute safe effects, install the five-minute timer and pass the actual standby matrix. The journal cannot turn an injected fixture into evidence that those integrations exist. No UI/screenshots apply.

## Migrations, environment and manual steps

Final local combined verification passes **918 unit tests/138 files + all 199 legacy checks, strict types and lint**. Source/history/audit and exact-head CI remain required before merge.

No migration, dependency, RLS/CSP change, new environment variable or hosted mutation. No OCI/registry/worker credential is read. Oracle signup still requires the owner's manual browser handoff; OCI setup waits for Oracle account active. Publication is disabled. After actual free eligibility/standby credentials are verified, use mocks and anvesh.mannuru+ir35test@gmail.com only; verify health and recovery before cutover. Keep APPLY_RUNNER=vercel and APPLICATION_WORKER_ACCEPT_JOBS=false until literal YES CUTOVER. A passed journal suite is not deployment, production verification or completion of Phase 0.
