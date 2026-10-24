P5 isolated SDK repair **PASS**; stopping for owner review before P6. PR54 remains draft/unmerged.

| Gate | Result |
|---|---|
| Private Caddy/stub reproduction + fixed route |PASS: final7/7, no ports/data/secret mounts; two bounded rounds preserved|
| Native ARM Caddy validate/adapt + redacted JSON diff |PASS|
| ONE protected staging activation |10/10PASS: SDK401/401/200, jobs200/H1/securecookie/noindex/no-store, maintenance503, API401/200|
| Post-containment |PASS: all manifests,62table orderedMD5/2sequences/schema only3approved exceptions/552privileges/73StorageSHA256, both pristine+app|
| Tests |295helpers PASS; Docker CI regression added; hosted result reported separately|

Root cause: `handle` reorders children, so SDK terminal404 preempted proxy. Literal nested `route` now guarantees guard→rewrite→proxy→fallback. Every case writes intent+result before assertions, including failures; actual Caddy UUID/matched route and redacted headers retained. Earlier failed journals/counters unchanged. One diagnostic-label repair was required privately; no third private round or second new edge attempt.

Edge seal `894c6408b8c47329106d0061666e728a0224d92e6cc7e8410944722d60ce616c`; containment `490c142636551da7a093791920b47b8562b65f1f4afb0501a1713fc9cbfe600b`. Evidence/diffs: [signoff](https://github.com/IR35careers/IR35/blob/codex/oracle-migration-p5/docs/evidence/oracle-p5-sdk-owner1.md), [case records](https://github.com/IR35careers/IR35/tree/codex/oracle-migration-p5/docs/evidence/p5-sdk-owner1).

Auth health is200. Whole-stack health truthfully remains503 because worker/Realtime are outside this repair; no fake readiness/P6 activation. No production, DNS, cloud-Supabase, Vercel, Google, secrets, paid resources, merges or cutover changes. No owner manual steps for this repair apart from review. Do not run another edge activation or P6 without explicit owner authority.
