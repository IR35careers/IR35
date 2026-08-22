# IR35Careers security audit

Audit date: 22 August 2026
Application: IR35Careers web application and supporting APIs
Scope: source code, API boundaries, authentication and authorisation, Supabase policies and storage, automated application runner, webhooks, file handling, browser storage, service worker, security headers, dependency inventory and repository history
Status: application changes complete and verified; database migration `017_security_hardening.sql` must still be applied to production and the new repository security workflows must still be pushed to GitHub

## Executive summary

This review found no evidence of a leaked production credential, cross-account data read, SQL injection, remote command execution or known vulnerable npm dependency. The existing application already had strong controls around live Supabase token verification, owner-scoped row-level security, service-only financial and submission ledgers, webhook verification and short-lived signed administrator sessions.

The review did identify several meaningful weaknesses, particularly around server-side URL fetching, browser automation, recruiter email replies, client-written application state and concurrent rate limiting. These have been fixed in the application. The most important changes constrain the automated application runner to approved ATS hosts, prevent candidate data from being sent to arbitrary third-party hosts, pin validated DNS results during server-side HTTPS requests, enforce real streamed request-size limits, clear private browser data at sign-out, prevent spreadsheet formula execution, restrict recruiter replies to independently verified recruitment destinations and make durable throttling atomic.

Security is an ongoing risk-management process. This audit does not claim that any internet-facing application can be made perfectly secure or permanently threat-free. The assessment is a source-assisted review and automated verification pass, not a substitute for an independent penetration test, continuous monitoring, credential rotation and provider-level controls.

## Risk findings and remediation

| Severity | Finding | Risk before remediation | Remediation | Status |
| --- | --- | --- | --- | --- |
| High | Automated application runner accepted arbitrary public destinations and third-party requests | A malicious destination could attempt to receive candidate profile data, tailored CV content or answers | Initial destinations now require a supported ATS or explicit server-side allowlist. After candidate fields are populated, requests are restricted to approved hosts. Spoofed suffixes such as `evilashbyhq.com` no longer match trusted ATS domains | Fixed in application |
| High | Server URL validation was vulnerable to DNS rebinding between validation and fetch | A hostname could validate against a public IP and later resolve to a private or metadata address | All A and AAAA results are checked and the approved address is pinned into the HTTPS connection while preserving TLS SNI and the Host header. Redirects are revalidated and bounded | Fixed in application |
| High | Users could write their own private recruiter inbox alias through browser database access | A user could alter a server-assigned mail identity or forwarding destination | Browser code no longer writes aliases. Migration 017 changes the table to owner-read-only and revokes authenticated insert, update and delete privileges | Code fixed; production migration pending |
| High | Candidate browsers could fabricate Applied state, provider receipts and delivery events in their own database rows | Application history could claim an employer submission that never happened | Browser persistence now accepts only pre-submission packet states and preparation events. Migration 017 revokes access to server-owned mode/receipt fields and delivery event types | Code fixed; production migration pending |
| High | Recruiter email could be used as a limited outbound relay | A signed-in user could previously choose an arbitrary recipient; a visible inbound sender is also not sufficient proof because sender fields can be spoofed | Free-form compose was removed. Replies require an owner-linked inbound message and the recipient must exactly match the independently verified recruitment address tied to that application. Unverified inbound senders cannot change application state or trigger forwarded customer notifications | Fixed in application |
| Medium | Several endpoints trusted `Content-Length` without bounding streamed bytes | Requests without an accurate header could consume excessive memory or parser work | Shared bounded readers now enforce the actual streamed byte count for JSON, text and multipart bodies and return 413 for oversized requests | Fixed |
| Medium | Public and expensive endpoints lacked consistent abuse throttling | Automated abuse could consume parsing, AI, email or database capacity | Privacy-hashed per-client and per-user rate limits were added to job preview, contact, resume parse/export, application preparation, employer onboarding, inbound mail and recruiter email | Fixed |
| Medium | Durable rate limiting used a count-then-insert sequence | Concurrent serverless requests could all pass the same limit before their audit rows were inserted | Migration 017 adds a service-role-only `SECURITY DEFINER` function with a fixed empty search path and a transaction-scoped advisory lock per privacy-hashed key | Code fixed; production migration pending |
| Medium | Sensitive administrator responses relied on route-local cache behaviour | A future admin handler could accidentally return cacheable private data | Middleware now forces `Cache-Control: no-store, private` and `Pragma: no-cache` for the entire administrator API namespace | Fixed |
| Medium | The service worker could cache broad same-origin static or image responses under an old cache version | Private or user-specific responses with an image/static destination could persist on a shared browser | Cache scope is limited to versioned Next.js static files and `/images/`; the cache version was rotated, and activation no longer forces a disruptive page reload | Fixed |
| Medium | Sign-out retained CV and workspace data in local browser storage | A later user of the same browser profile could see private local data | Sign-out, cross-tab sign-out and account-identity changes now clear workspace, CV and administrator draft state | Fixed |
| Medium | Account deletion enumerated only the first storage level | Nested CV objects could remain after account deletion | Deletion now recursively inventories the private user folder with depth and file-count safety limits before removal | Fixed |
| Medium | CSV exports did not neutralise spreadsheet formulas | Opening an export could execute attacker-controlled spreadsheet formulas | Cells beginning with `=`, `+`, `-`, `@`, tabs or carriage returns are prefixed safely | Fixed |
| Medium | Security headers supplied only a minimal CSP | The browser had less defence in depth against injected resources and data exfiltration | A full same-origin CSP, restricted Supabase connections, frame protections, HSTS, no-sniff, permissions restrictions, origin isolation and disabled DNS prefetching are now sent | Fixed |
| Medium | Static CSP required permissive inline script handling | An injected inline script would have had less browser-level resistance | Each response now receives a cryptographically fresh nonce. Next.js scripts and structured data use that nonce, `strict-dynamic` is enabled and script attributes are denied | Fixed |
| Medium | Browser connections were allowed to every Supabase tenant | If script execution were ever obtained, the broad connection rule could provide a convenient external data-exfiltration destination | The CSP now derives a connection allowlist from the one configured HTTPS Supabase origin and its matching secure WebSocket origin. Missing or insecure configuration fails closed to same-origin only | Fixed and deployed |
| Medium | Upstream AI and submission services could return an unbounded response | A compromised or faulty provider could consume excess memory before JSON parsing | Provider responses are streamed through bounded readers before parsing. Oversized and malformed responses fail closed | Fixed |
| Medium | Application submission held the browser request open for the full external portal run | Slow or blocked portals could leave the customer seeing an indefinite loading state and encourage duplicate clicks | The approved packet is durably queued first, the API returns 202 immediately, and the portal run continues in the server lifecycle while the UI polls the owner-scoped status endpoint | Fixed |
| Medium | Provider emails relied on an informational duplicate header only | A retry could send the same employer application or customer notification more than once | Stable, hashed Resend idempotency keys are now supplied to the provider for both employer applications and customer notifications | Fixed |
| Medium | Administrator APIs were reachable on public website hosts | Authentication was still enforced, but the public origin unnecessarily exposed the administrator API surface | Administrator APIs and session endpoints now reject non-admin hosts. The public domains return 404 before administrator authentication is evaluated | Fixed |
| Medium | Release workflows used movable action tags and lacked a required security job | A compromised upstream tag, committed credential, vulnerable dependency or semantic code weakness could reach a future release without a dedicated gate | Official GitHub Actions are pinned to immutable verified commit hashes, checkout credentials are not persisted, CI scans tracked source and full Git history, `npm audit` fails on any known vulnerability, CodeQL is configured to run extended JavaScript/TypeScript security queries, and Dependabot proposes weekly npm and workflow updates | Fixed locally; GitHub push pending |
| Medium | Transitive dependency installation scripts were not explicitly reviewed | A future clean installation could execute lifecycle code from dependencies without a repository-level decision | The only two detected transitive install-script packages, `esbuild` and `unrs-resolver`, are explicitly denied. CI performs clean installations with strict enforcement, the npm version is pinned consistently, and npm reports no unreviewed scripts | Fixed and deployed |
| Medium | The package manifest and lockfile had drifted | A clean CI runner could not reproduce the dependency installation, preventing release security gates from running reliably | The lockfile was regenerated with the pinned npm release and a strict clean installation was completed before the full release suite | Fixed and deployed |
| Low | The PDF export dependency retained two deprecated transitive libraries | Deprecated cryptography and JPEG metadata packages would remain in the server dependency inventory even though no vulnerability was currently reported | PDFKit is upgraded to the maintained release that replaces both dependencies. Current compatible patch releases for the core web, database and email libraries are also pinned and re-audited | Fixed and deployed |
| Medium | Authenticated deployments could retain private workspace and CV records in browser local storage | Private application material could persist outside the server-side account boundary | Production Supabase deployments now fail closed to authenticated cloud storage and remove legacy local workspace data. Administrator drafts use session storage only | Fixed |
| Low | Privacy hashing could fall back to a static value | Identifiers in operational logs could be guessable across environments | HMAC hashing now requires a deployment secret in production | Fixed |
| Low | Pipeline cron secret used ordinary string comparison | Comparison was not timing-safe | Secret comparison now uses a fixed-length cryptographic timing-safe comparison | Fixed |
| Low | Provider error details could reach the recruiter email caller | Internal provider details could be disclosed | The endpoint now returns a generic failure and is rate-limited | Fixed |
| Low | Some server failures logged or returned excessive provider detail | Operational logs or callers could receive unnecessary upstream information | Job search, CV export, onboarding and automation failures now expose generic messages and record only error classes needed for operations | Fixed |
| Low | Production OAuth origin selection accepted localhost | A malformed production request could select a development callback origin | Localhost callbacks are now accepted only outside production | Fixed |

## Controls verified as already present

- User API access validates the live Supabase access token on the server instead of trusting browser claims.
- Administrator access uses a dedicated allowlist and a short-lived, HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Strict` session cookie.
- Supabase tables containing profiles, CV versions, applications and messages use owner-scoped row-level security.
- Billing, application-submission and other sensitive ledgers are server-write-only.
- Stripe and inbound email webhooks verify provider signatures before processing trusted events.
- Application status is marked Applied only after a positive employer/ATS confirmation signal.
- Employer and customer email delivery uses provider-enforced idempotency so a retry cannot duplicate an application or status message.
- CAPTCHA, login and verification challenges are not bypassed; the application moves to Needs You.
- CV parsing and export enforce supported formats and bounded file sizes.
- A standard `.well-known/security.txt` route publishes the responsible-disclosure policy.
- The OpenRouter mapper receives only the candidate evidence needed for the task and requests zero-data-retention/no-collection provider handling. OpenRouter is not permitted to authorise or confirm a job submission.
- No production secrets are exposed to client bundles through `NEXT_PUBLIC_*` variables.

## Verification evidence

Completed on the audited revision:

- TypeScript: passed with no errors.
- ESLint: passed with zero warnings.
- Unit tests: 179 passed across 48 files.
- Processing, tax, aggregator and fetcher tests: 194 passed, 0 failed.
- Production Next.js build: passed; 68 static pages generated and all dynamic routes compiled.
- Deployed production browser smoke tests: 6 passed, covering account boundaries, public trust pages, private feed-health routing, safety assets, reduced-motion navigation and canonical/private-page indexing rules.
- Live HTTP checks: full CSP and HSTS present, framing denied, CORS does not trust an unrelated origin, TRACE is rejected, accidental `.env`, `.git/config` and `package.json` paths return 404, public-host administration returns 404, unauthenticated dedicated-host administration returns 401, private routes are marked `noindex`, private-address job preview returns 400 and oversized requests return 413.
- The production CSP permits only `https://kxcbgflleqnjzjbkevwd.supabase.co` and its matching `wss://` origin for Supabase connectivity; wildcard tenant access is absent.
- Independent MDN HTTP Observatory scan 116152683 returned grade A+, score 125, with 10 of 10 tests passed and zero failed.
- Direct TLS handshakes reject TLS 1.0 and 1.1, accept TLS 1.2 with ECDHE/RSA/AES-GCM and TLS 1.3 with AES-GCM, and present a valid certificate for `www.ir35careers.com` through 14 October 2026.
- Production deployment `dpl_FptuzJmTW3VtLeKQ8e3h8YF1ex22` is Ready and serves `www.ir35careers.com`, `ir35careers.com` and `admin.ir35careers.com`.
- Anonymous Next.js build telemetry is disabled in the Vercel production environment; the verified deployment emitted no telemetry notice.
- npm dependency audit: 0 low, moderate, high or critical known vulnerabilities.
- npm registry integrity: signatures verified for 632 packages and provenance attestations verified for 150 packages.
- Reproducibility: `npm ci --strict-allow-scripts` completed from an empty dependency directory, npm reported no unreviewed scripts, the two deprecated PDF transitive dependencies were absent, and the full 179-unit/194-processing-test release build passed from that clean installation.
- Git patch validation: passed; no whitespace errors.
- Repository and Git history secret-pattern scan: no OpenRouter, live Stripe, Google API, GitHub token, Supabase JWT or private-key patterns detected. The only tracked environment file is the placeholder `.env.local.example`.
- The repeatable `security:source` gate passed across 368 tracked files and complete local Git history; all external workflow actions are pinned to full commit hashes.
- A pinned CodeQL workflow is configured for pushes, pull requests, manual runs and a weekly schedule with the extended JavaScript/TypeScript security query suite. It becomes active after the security commits are pushed to GitHub.
- New regression tests cover streamed body and upstream-response limits, JSON media types, public/private IPv4 and IPv6 rejection, spoofed ATS-domain rejection, administrator host/cache restrictions, server-owned application states, database function privileges and verified recruiter recipients.
- CSP regression tests verify that only the configured HTTPS Supabase project and its matching secure WebSocket origin are permitted, with no wildcard tenant access and a same-origin-only fallback for insecure configuration.

## Application submission verification

The reported indefinite loading state was reproduced against the affected CRM Developer listing. Its Adzuna destination returned HTTP 403 from CloudFront, and the corresponding Reed application requires a job-board account sign-in. No employer confirmation was produced, so the absence of an application receipt or confirmation email was correct.

The product now treats HTTP 401, 403 and 429 responses, sign-in requirements, CAPTCHA and verification prompts as a Needs You result. It does not mark those applications Applied. A successful receipt and customer confirmation email are created only after the employer portal or a verified recruitment email destination confirms acceptance.

Submission now starts as a background operation after the approved packet is durably recorded. The customer can leave the page while the workspace checks progress. Failure, Needs You and Applied outcomes all terminate the processing display and are recorded in the application timeline. The browser runner and Playwright versions are aligned with the deployed Chromium runtime.

## Production database action required

Apply `supabase/migrations/017_security_hardening.sql` to the production Supabase project. Until it is applied, the website code no longer writes aliases, receipts or post-submission events from the browser, but a user with direct API knowledge may still exercise the old broad database policies. The migration also activates storage MIME/size enforcement, an explicit owner check for object updates, owner-only draft/event privileges, the operational rate-limit index and the atomic rate-limit function.

The migration was not represented as applied because the available signed-in browser-control connection could not initialise and the local Supabase CLI has no authenticated access token. No database credential is stored in the repository. This is an operational dependency, not a code failure.

## Residual risks and recommendations

1. Arrange an independent authenticated penetration test before a large public launch, then repeat after significant authentication, payment or automation changes.
2. Apply migration 017 and verify it using one normal user and one separate test user. Confirm that cross-user reads/writes and client-side alias updates fail.
3. Enable and review Vercel Firewall rules, attack traffic, rate-limit observations and deployment logs. Application-level rate limiting is defence in depth, not a replacement for edge protection.
4. Review Supabase authentication logs, database logs, leaked-password protection, MFA options and custom SMTP/OAuth configuration.
5. Rotate high-value provider secrets on a schedule and immediately after any suspected disclosure. Keep secrets only in Vercel/Supabase secret stores.
6. Keep the native browser runner on a separate, tightly restricted execution boundary as scale increases. It intentionally does not bypass authentication, CAPTCHA or employer verification.
7. Maintain the ATS allowlist. New providers should be added only after their host boundaries, submission confirmation and data flows are tested.
8. Verify data-processing agreements and retention settings for Supabase, Vercel, Resend, OpenRouter, Stripe and any ATS integration used in production.
9. Add centralised alerting for repeated 401/403/429 responses, webhook signature failures, admin-session failures, unusual account deletion volume and browser-runner egress blocks.
10. Re-run `npm audit`, the complete test suite and the source/history secret scan in CI for every production release.
11. The native runner cannot and must not bypass employer account login, CAPTCHA, identity checks or one-time verification. Direct submission to those destinations requires a user-authorised browser session or an official employer/ATS integration.
12. Keep automatic recruiter-state transitions limited to independently verified recruitment senders. Messages from other senders may be stored for review, but must not mark applications Applied, Interview or Rejected automatically.

## Reference standards

- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- Next.js Content Security Policy guide: https://nextjs.org/docs/app/guides/content-security-policy
- Supabase Row Level Security guide: https://supabase.com/docs/guides/database/postgres/row-level-security
- Vercel Firewall documentation: https://vercel.com/docs/security/vercel-firewall
