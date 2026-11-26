# Main security preparation — 25 November 2026

Recorded 2026-11-25 15:13:20 UTC. This is a separate local worktree, not a production or deployed-source assertion. No push, PR, merge, deployment, cloud mutation or credential access has occurred.

- Worktree: `C:\ir35-security-main-20261125` (absent before creation).
- Branch: `codex/oracle-security-main-20261125` (absent before creation).
- Exact public main base: `df8ee7f37119f76c9cdca5e2a510278bc473517b`.
- `AGENTS.md`, `docs/spec.md`, `docs/architecture.md` and `docs/progress.md` read completely before implementation.
- Existing `vercel.json` disables `codex/oracle-*` and main deployments. It must remain byte-identical.
- Original and migration worktrees remain untouched.

## Raw local baseline SHA-256

These hashes cover this Windows checkout's exact bytes, including line endings; they are not Git blob hashes.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| AGENTS.md | 7230 | a643a237ffa2746a3c58cb9131a52007dd03d6b92aa760b8439251dffede0ac8 |
| docs/spec.md | 13974 | 7f65b9a01c5fccb4f57474c03d1ea5865d04c1be941f6d797f455995bd94bb1e |
| docs/architecture.md | 22397 | 0e454d17133b258d21b5866230fa742e24a30e19016a24570fbb4e40fdd94359 |
| docs/progress.md | 92357 | a6e9ce87c22c77842c6cc112a67633e5875631e01eec638ee8067cbe046daece |
| package.json | 3280 | 551a2c3d86101fcad445485b9ef11ffb46aecce0f723f0594a96110fdc9232d4 |
| package-lock.json | 409500 | be77dd8da0c9677f94afabc5371c9a07cca97e33a78b323f6add33c3ffcbc282 |
| vercel.json | 618 | 8ee71a8cec329ed8f8a1e0265bdcc1350c3cf9d2040bc2448322e73ea0438405 |

## Independently verified dependency metadata

Public npm registry GETs verified exact Next/config 16.4.6, React/React DOM 19.2.9, typescript-eslint 8.74.0, Queue 0.11.0 and minimatch 11.0.9 metadata. Queue 0.11.0 still declares minimatch `^10.2.4`, requiring a consumer-scoped override. Next/config accepts the selected React and TypeScript ESLint versions; Node 24.13.0 satisfies their engines.

The untouched baseline contains minimatch 3.1.5 (unaffected) and two 10.2.6 copies (production Queue and development TypeScript ESLint). GitHub's [corrected advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) affects >=7.0.0 and <11.0.1, not 3.x.

Fresh pinned-npm audit metadata reports 17 affected dependency entries: 1 critical, 6 high, 10 moderate. Beyond the proposed core patch it flags Vitest/mocker, Vite and nested Zod via Vercel CLI configuration and Chromium BiDi. Further parent-first updates require review before changing the manifest. This is a failing baseline, not a release PASS.

The two existing exception entries expired on 29 October. Neither appears in the fresh audit. GitHub confirms [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) were withdrawn. Main's current evaluator deliberately fails expired entries even if absent; its exact-list unit assertion is unchanged. Renewal/removal has not been performed.

## Verification still required

Independent install, lint, strict types, full unit/legacy suites, actual Queue SDK compatibility, production build, complete audit, registry signatures and hosted checks remain pending. No assertion, timeout, workflow, RLS/CSP, production setting or secret has changed.
