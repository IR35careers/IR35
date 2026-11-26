# Separate main security verification

Recorded 26 November 2026. This supersedes the pending-approval/verification statements in the immutable baseline; it does not overwrite historical evidence.

Base: `df8ee7f37119f76c9cdca5e2a510278bc473517b`. Branch: `codex/oracle-security-main-20261125`. Worktree: `C:\ir35-security-main-20261125`. No source/runtime migration changes were copied from the migration worktree.

## Version changes

| Consumer | Main baseline | Verified candidate |
| --- | --- | --- |
| Next / eslint-config-next | 16.4.0 / 16.4.1 | Both 16.4.6, exact |
| React / React DOM | 19.2.8 | Both 19.2.9, exact |
| Queue | 0.8.0 | 0.11.0 |
| Queue minimatch | 10.2.6 | 11.0.9, Queue-only override |
| TypeScript ESLint / its minimatch | 8.67.0 / 10.2.6 | 8.74.0 / 11.0.9, supported parent dependency |
| Unaffected ESLint minimatch | 3.1.5 | Unchanged 3.1.5, callable API and helpers tested |
| Root Zod | 4.6.7 | Unchanged 4.6.7 |
| CLI configuration Zod | Nested 4.1.11 | Existing root 4.6.7, consumer-only override |
| Vitest / mocker | 4.1.11 | Both 4.1.12 |
| Vite | 8.2.1 | 8.2.4, supported Vitest range; no override |
| Lighthouse | 13.4.1 | 13.5.0; patched parent removes affected BiDi/Zod path |

Fresh registry metadata showed the latest compatible OIDC 3.x still pins affected CLI configuration/Zod. Only that Zod consumer is overridden, not unrelated Zod callers or an unreviewed OIDC major. Actual CLI parser valid/invalid cases run without private file/network access. Actual Queue SDK publication, callback, malformed callback and glob-route registration cases use intercepted synthetic transport; no employer, queue service or database is contacted.

The two existing withdrawn-advisory entries retain exactly their original IDs, packages and versions and only the owner-approved 30 November expiry/reason renewal. The fresh raw audit contains no vulnerabilities and uses neither exception. No new exception, advisory bypass, workflow, existing assertion or timeout change.

## Local gates

| Gate | Result | Write-once evidence |
| --- | --- | --- |
| npm 11.19.0 clean install, scripts disabled | PASS, 688 packages | install.json |
| Final manifest/lock consistency | PASS, offline ci dry-run | ci-consistency-01.json |
| Focused actual SDK/dependency/parser/bot checks | PASS, 35 tests | focused-tests-01.json |
| Strict TypeScript | PASS | typecheck-01.json |
| Full zero-warning lint | PASS | lint-01.json |
| Full unit suite | PASS, 923 tests / 140 files | full-unit-01.json |
| Legacy processing/tax/connectors | PASS, 199 checks | test-legacy-01.json |
| Production Next build | PASS, 89 static pages | build-01.json |
| Complete fresh security audit | PASS, zero findings | raw-audit-01.json; security-audit-01.json |
| Registry signatures / attestations | PASS, 688 / 158 | security-signatures-01.json |
| Actual Lighthouse CLI loading | PASS, help only; no browser/network audit | lighthouse-help-01.json |
| Staged source and repository history scan | PASS, 752 tracked files at initial scan | security-source-01.json |

Unit concurrency was limited by CLI `--maxWorkers=1`, without modifying configuration, assertions or test timeouts. The build finished at 15:31:58 UTC on 25 November and was recovered from the original result/session after the pause; it was not rerun. Its only warning is Queue's documented region fallback in a non-Vercel build, not a transport call. Build and audit subprocesses used a tool-only environment, excluding cloud/provider credentials. No environment files exist in this worktree.

All package resolutions are public npm registry URLs with integrity fields. `vercel.json` remains byte-identical to the baseline SHA-256 `8ee71a8cec329ed8f8a1e0265bdcc1350c3cf9d2040bc2448322e73ea0438405`; existing main and `codex/oracle-*` deployment holds remain disabled. There is no new Vite/global minimatch override or compatibility shim.

## Release boundary

Root review, a draft PR and all fresh final-head hosted checks are still required. No push, PR, approval, merge, deployment, production setting/data/provider/DNS/IAM/network change, secret access, real email or employer submission was performed. Migrations: none. New environment variables: none.

The owner supplied **YES CUTOVER** on 26 November. It does not waive failed/remaining safety gates or the human-only merge rule; this independent branch remains local-only until root review.
