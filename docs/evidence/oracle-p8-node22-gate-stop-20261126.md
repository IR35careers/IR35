# P8 verification hard stop — 26 November

Owner **YES CUTOVER** is received, but safety gates are not waived. No cutover or production/DNS/old-stack data change has executed.

## Exact failing gate

`tests/unit/oracle-inventory.test.ts:35`: Oracle metadata-only inventory / executes the RLS regression against real disposable PostgreSQL.

The third bounded run used official portable Node22.23.5, a fresh empty HOME, the unchanged test/config/dependencies and no compiler warm-up, external pre-initialisation, assertion edit or deadline change. Result:11/12pass, failing case6,034.8224ms, process exit1. Its JSON reporter exposes `Error: STACK_TRACE_ERROR`; it does not prove a precise timeout cause. The previous Node24 full/focused runs explicitly failed the five-second deadline. Do not replace the reporter error with a more convenient diagnosis.

Sealed directory: `p8-node22-rls-20261126-01/`. Manifest SHA-256: `f7940fa1ca11b0e6a488fa0384518ed17a42b13c29deb8a03b2bd641ad8ddc68`. Every failure artifact is retained; no private state, VM call, real email or employer submission was involved.

## Other authoritative progress

- [Main security draft #67](https://github.com/IR35careers/IR35/pull/67), head `1e87d188fbc9eca447d60e050c63ec48ea931534`:923localunit/199legacy checks, build/lint/types/audit/signatures PASS;19GitHub jobs PASS,3existingpolicy skips,0pending/failing GitHub jobs. ExternalVercel **Account is blocked** remains a failure. No merge/deployment/upgrade or release waiver.
- OCI-only lifecycle family51PASS, source bound, real fsync/O_EXCL, unchanged180s; seal `3c7da722504b839869a798c467e846874830a46aaf054e3fc29a8f95324a298c`. No SSH prerequisite or cloud write; unchanged one-VM/one-bucket scope, prior-slot verification and rollback guards. Native allowance unused.
- Private QA runtime source20focusedPASS (17unchanged+3new), not functional native QA. Optional fixture-TMPDIR harness17focusPASS (6old unchanged+11new); full new Python suite not started.

## Stop and proposed next action

No fourth automatic RLS run, timeout/assertion change or native promotion. Seek owner review before reopening verification. A proposed verification-only option is one complete unchanged run in the project's canonical Linux/Node22 GitHub environment, after current-source prerequisite checks, with no paid runner or workflow bypass. Historical `dc00103` release-step success and matching test/dependency bytes support this environment hypothesis but are **not** a current pass; direct historical per-case logs/timing remain unavailable.

Oracle authentication alone does not clear this hard stop. Preserve the existing login session without replay; no SSH/API passphrase or new secret is needed merely to review this report. G3 remains closed. Full backup/restore/reverse/writable QA/monitoring/final verification and human release remain mandatory before traffic can move.
