# Temporary dependency risk decisions

## 30 October 2026 — withdrawn advisories, exactly two owner-renewed entries

GitHub's advisory API/pages confirm GHSA-vfj7-8cjw-p6xm withdrawn23October and GHSA-hp3w-g68c-fv3c withdrawn22October. Fresh `npm audit --json` returned a valid versioned response with zero vulnerabilities/no advisory IDs. The permitted removal alternative passed live audit, but failed the existing immutable two-entry allowlist contract (8/9 unit tests). Under the owner's explicit alternative approval, retain ONLY these same IDs/packages/versions until `2026-11-30T00:00:00Z`, each with reason `withdrawn advisory; GitHub withdrawal verified 30 October 2026`. Provenance text satisfies the unchanged minimum30-character reason validator; the short literal alone was correctly rejected. No dependency version, security workflow, existing assertion, expiry evaluator or other bypass changed or backdated; all other findings still fail. Both intermediate failed configurations remain recorded in the repair history, not treated as final PASS.

## Historical bounded exception review — original expiry superseded explicitly

The owner explicitly approved **only two** temporary advisory exceptions in chat, expiring 29 October 2026. This is an accepted, bounded residual risk, **not a claim of zero vulnerabilities**. `security/audit-exceptions.json` ends approval at **2026-10-29 00:00 UTC**; CI fails once it expires. All other findings, advisory IDs, installed versions and incomplete audit responses still block. No severity threshold is raised.

| Advisory | Exact installed package | Exposure and decision |
| --- | --- | --- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | braces 3.0.3 | No upstream patched version at review. Development-only dependency of Tailwind/ESLint glob handling; repository-owned build patterns, not contractor uploads or request input. Do not introduce runtime glob parsing of user input. |
| [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | sprintf-js 1.0.3 | No upstream patched version at review. Mammoth's command-line argument parser dependency; the application imports the library's `extractRawText`, never `bin/mammoth` or CLI format strings. A module-graph regression verifies argparse/sprintf-js are not loaded by that entry point. |

The [selector-parser CPU-exhaustion advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) **is not excepted**. Pin its patched 7.1.6 release through npm overrides. Verify the full production CSS build and responsive browser suite because Tailwind 3 declared the older parser major. Do not downgrade Next.js/Mammoth or migrate Tailwind wholesale merely to make the audit quiet.

`npm run security:audit` still executes live `npm audit --json`. Its validator follows dependency-wrapper findings to their advisory leaves, matches exact IDs/packages/lockfile versions, rejects unknown/malformed responses and expired approvals, and prints every exception. New findings remain blocking regardless of severity. `tests/unit/dependency-security.test.ts` covers these rules and the reachability constraints. Registry-signature verification and repository/history scanning remain separate required checks.

Before expiry: recheck upstream releases and remove each exception when fixed; otherwise obtain a new explicit decision. Do not automatically extend the deadline. Reassess immediately if build inputs become untrusted, Mammoth's CLI is invoked, a dependency changes, or new reachability evidence appears.
