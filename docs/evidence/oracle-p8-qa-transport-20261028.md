# P8 owned QA transport and private backend plan — SOURCE verification

28 October 2026. Draft PR62 only; **not an Oracle activation or full P8 PASS**.

| Gate | Observed result |
| --- | --- |
| Transport, actual loopback CONNECT relay and browser-context regressions | 48 PASS / 3 files |
| Full application verification | 1297 unit tests / 176 files PASS, 188.36s; 199 legacy PASS; strict TypeScript and full zero-warning lint PASS |
| Full helper suite, fresh empty HOME | 678 PASS, 98.119s; no `.ir35`, private files, real keys or VM calls |
| Helper artifact seal | `5929823ca07da026727555af0d9799ac59cafa551a087770a844288e708be72a` |
| Previous exact committed source c1ccd56 | All 11 hosted checks completed SUCCESS; this is NOT hosted proof for the new uncommitted source |
| New real Caddy routing/Bearer regression | CI step prepared; native Docker result pending |
| Native fixture / browser Auth + app writes / Realtime CDC / worker callback + restart / cleanup | NOT RUN by this change |
| New image, VM/OCI resource, production/provider/DNS/IAM/secret-value changes | 0 |

The [helper result](p8-qa-transport-hermetic-01/result.json) and [manifest](p8-qa-transport-hermetic-01/manifest.json) are write-once. Complete synthetic logs stay in the existing ignored local evidence paths, not uploaded as private runtime material. The earlier six-case edge test output was lost after its process exited; no PASS was inferred. A fresh **offline-only** observation passed all six in 0.005s. No consumed native slot was replayed.

## What is implemented

- Exact-origin/method/path/request-body boundaries. External/provider/employer/action requests are rejected; negative RLS requests still reach the actual isolated server. API responses and browser sessions are never fabricated. Raw headers, bodies, URLs with tokens, and error messages are not public evidence.
- A local, loopback-only CONNECT relay forwards opaque bytes **only** from the browser's `staging.ir35careers.com:443` connection to an already attested SSH-forward port. No DNS resolution, MITM certificate, TLS exception, external proxy, VPN, public listen port or credential capture. Actual browser TLS/cookies/redirects/WebSocket frames remain native. The full controller must first prove the tunnel's destination is the new owned fixture, never the original/public edge.
- A fresh browser context with service workers blocked and genuine TLS verification. Actual requests use `route.continue`, not fulfilled/mock Auth or application responses. The private edge verifies Basic through its separate header, then restores the user's Bearer header for app APIs. SDK Bearer/apikey/cookies are preserved. Allowed Realtime sockets connect to the real server without message replacement or inspection.
- A separate nonroot/read-only128MiB Caddy plan, no published ports, private8443 only, literal SDK guard/rewrite/proxy/fallback order, original Basic/gate credentials, secure gate cookie, noindex and exact no-store. Existing certificates are mounted read-only; no ACME, certificate copying or public-edge edit. Certificate path/custody/expiry and actual validate/adapt remain native prerequisites.
- A separate256MiB pinned ARM Realtime plan. Metadata and CDC point to the owned QA clone, not operational `postgres` or original app databases. Unique tenant/hostname alias and slot suffix; janitor off, bounded pools, admin routes still403, no old global alias. No Realtime service/schema/publication/slot has been started or created by these source changes.
- The VM-side preparation can assemble this complete private plan before exclusive config writes. All credential values remain the existing staging-only values in VM600 files, not Git/argv/logs. Preparing a plan does not attest its runtime or permit ad-hoc activation.

Native QA still requires a complete bounded create/test/cleanup controller, source-bound fresh image proof, actual private network/certificate/resource checks, SDK401/401/200/Bearer proof, real UI and authenticated mock application/CDC/restart coverage, and original full containment BEFORE and AFTER cleanup. The original112HBA/database inventory must not be filtered for a temporary clone; eight actual clone denials apply while it exists.

## Retained offline failures and repairs

1. [Initial relay shutdown FAIL](oracle-p8-local-relay-initial-20261028.json): 9/37 assertions failed `QaLocalRelayConnectionLeak`. The listener close callback preceded socket close notifications. One repair now waits for both actual lifetimes before the **unchanged** no-leak guard. All original test assertions retained.
2. TypeScript then reported `TS2339` for the HTTP CONNECT peer's declared `Duplex` type. Runtime now requires an actual `net.Socket` before reading its peer address; no cast-based removal of the address guard.
3. New browser test mock initially inferred zero newContext arguments (`TS2352`/`TS2493`). Explicit mock function typing fixed only that offline fixture. Semantic assertions and timeouts unchanged.

The final full application/helper results above include these repairs. No failure was a VM/data/security mismatch, and no native attempt was consumed.

## Upstream references and remaining holds

Caddy [literal route order](https://caddyserver.com/docs/caddyfile/directives/route); Playwright [browser proxy option](https://playwright.dev/docs/api/class-browser#browser-new-context-option-proxy), [request continuation](https://playwright.dev/docs/api/class-route#route-continue) and [native WebSocket forwarding](https://playwright.dev/docs/api/class-websocketroute#web-socket-route-connect-to-server).

The exact pinned Realtime release [seed](https://github.com/supabase/realtime/blob/v2.143.3/priv/repo/seeds.exs) uses `DB_NAME` for its tenant database; [hostname tenant selection](https://github.com/supabase/realtime/blob/v2.143.3/lib/realtime/database.ex) uses the first host label. The [runtime](https://github.com/supabase/realtime/blob/v2.143.3/config/runtime.exs) supplies pool and slot-suffix controls. These source observations inform the isolation plan, not a claim that CDC has passed.

Backup age/offline-key custody and narrowly scoped bucket-access owner decisions remain in the existing single batch. Actual encryption/upload/restore, managed-Storage exact reverse, monitoring and timed end-to-end cutover/reverse drills remain unproven. G3 stays CLOSED. All PRs remain draft/unmerged, P8 incomplete, P9 preparation/NO-GO; exact **YES CUTOVER** absent.
