# P8 bounded read load PASS — full P8 still incomplete

Draft [PR62](https://github.com/IR35careers/IR35/pull/62). Immutable [load02 result](p8/readonly-load-02/01-load-memory-edge-containment-result.json), [manifest](p8/readonly-load-02/manifest.json) SHA256 `e95c2ff16232eb766195b2715f9671b48370b3af5e72a0f741ea2b62ab52c443`.

50 concurrent anonymous read sessions,4 requests each/200 total,0errors,8.869s elapsed. Generator ran on the same2OCPU VM against loopback TLS/Caddy; protected responses are deliberately no-store. This is neither remote-network nor authenticated-write throughput, not proof of a production latency SLO and not a replacement for full browser flows. No SLO threshold was invented.

| Route | Requests | p95 ms |
| --- | ---: | ---: |
| `/jobs` |50|4277.268|
| `/tools/ir35-status` |50|3020.846|
| `/tools/take-home` |50|2644.586|
| `/api/health` |50|1911.669|
| Overall |200|3883.508|

All load responses200/noindex/no-store, pageH1 checks PASS. Protected robots/sitemap/llms/account/dashboard GET checks PASS; anonymous account-page redirects are not a signed-in dashboard proof. Health reported actual running dependencies, no fake readiness.

Six whole-machine memory samples; minimum OSavailable9,264,906,240bytes (>2GiB). Sampling has per-sample overhead, so0.25s is the scheduled delay, not a claim of exact0.25s sampling coverage. ProcessRSS values are **sampled** peaks, not kernel peaks. Every running container has a positive unchanged Docker limit equal to kernel `memory.max`; cgroup current and lifetime peak<=limit, OOM/kill0. Lifetime peaks were NOT reset. Meta's historical max-event count112 stayed112 during the run.

| Container | Sampled RSS peak bytes | Sampled kernel charge peak bytes | Limit bytes |
| --- | ---: | ---: | ---: |
| ir35-p5-auth |33103872|12218368|268435456|
| ir35-p5-kong |150130688|127688704|402653184|
| ir35-p5-rest |81412096|56119296|268435456|
| ir35-p5-storage |138899456|89563136|536870912|
| ir35-p5-web |258031616|170500096|1610612736|
| ir35-p6-mock-worker-v7-fixedip |139890688|84852736|2684354560|
| ir35-staging-auth-1 |32034816|15028224|268435456|
| ir35-staging-caddy-1 |50556928|28000256|134217728|
| ir35-staging-db-1 |1488113664|1213300736|3221225472|
| ir35-staging-kong-1 |153829376|163123200|402653184|
| ir35-staging-meta-1 |152690688|117981184|134217728|
| ir35-staging-rest-1 |84410368|53284864|268435456|
| ir35-staging-smtp-1 |22994944|11292672|67108864|
| ir35-staging-storage-1 |134811648|83787776|536870912|
| realtime-dev.supabase-realtime |262823936|212209664|268435456|

The original01FAIL remains intact. Read-only [diagnosis](p8/memory-diagnosis-01/01-cgroup-rss-pss-containment-result.json) proves its incompatible-metric comparison, not a real overrun. RSS≈PSS, so do not claim shared-mapping duplication was proven. Linux [memory ownership](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-ownership) explains charge ownership can differ from residency. OldRSS guard/tests still unchanged; separate kernel guard tests reject missing counters, limit mismatch, real overbudget/peak/OOM and<2GiBOS headroom. No limits/configuration/timeouts/hashes altered.

Post-load full containment PASS:62counts/orderedMD5/Auth,2sequences,3exact approved exceptions,552original privileges+approved queue roles,73Storage hashes and112fresh HBA checks. No real email/employer/production/cloud/DNS/IAM/secret changes. Existing mock worker and private SMTP sink retained.

Full586 fresh-home helper tests PASS41.293s before load02; original578 and failed native01 proofs retained. P8 still requires interactive browser/save/mock-apply QA, encrypted automated backups+real restore drill, tested reverse migration, current free/cost/storage audit and monitoring/alerts. `age`, known public recipient, backup and disk-alert timers absent; do not mark P8 complete. Failed OCI refresh still needs a single owner browser handoff, no repeated refresh/passphrase prompt.
