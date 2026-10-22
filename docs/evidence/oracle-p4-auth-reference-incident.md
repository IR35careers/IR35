# P4 Auth diagnosis and verification-reference incident —21October2026

Status: **STOP / P4 incomplete**, draft [PR53](https://github.com/IR35careers/IR35/pull/53). This is my helper failure, not a customer-account or cloud-password diagnosis. No production, Supabase cloud writes, Vercel, DNS, paid resource, merge or cutover changes.

## Password-free diagnosis

[Read-only result](oracle-p4-auth-diagnosis.json): exactly one named test account, confirmed email, null ban/deletion, false SSO flag, authenticated audience/role, one email identity, bcrypt password and **MD5 equality with cloud (boolean only, hash never exported)**. All checked fields match. Staging email enabled and autoconfirm false, as cloud's settings endpoint reports. Staging Site/API URLs intentionally differ from production; fresh staging JWT/anon/service signatures are internally consistent; no cloud signing secret fetched. Database destination is the isolated clone; SMTP is the private sink.

The first400 has no retained error body/logs (old container uses logging driver none). Its exact root cause remains **unknown**. No claim that a wrong password caused it, and no cloud password reset/login.

## What failed

1. Prepared a separate stopped-after-preflight Auth/Kong/PostgREST trio on the internal Docker network, fixed clone only, no public ports/outbound routes,896MiB aggregate hard limits. Original runtime/old denied container remain unchanged.
2. Health/settings/key-auth checks ran without a password. Request-ID-scoped log capture did not yield a matching projected log, so the readiness check failed. No password window opened; no OTP or magic-link request occurred.
3. **Root cause of evidence damage:** the new harness inlined the full audit into its own global namespace. The audit assigned `path` to the frozen source JSON. The harness's `save()` used that mutable global and wrote its `LOG_CAPTURE_FAIL` journal to the source JSON rather than its configured journal. This replaced its contents and changed ownership to root600. The separately configured new journal remains START_PENDING. Neither is reset or rewritten.
4. Subsequent native read-only audit refused `Private source custody required`. Metadata/hash inspection proved the overwrite. No second preparation, service restart, restore, artifact reconstruction or credential request followed.

The log-capture issue remains unresolved; no runtime repair attempt is allowed past the integrity hold. The oldHTTP400 failure and this tooling incident are distinct.

## Containment results

[Independent read-only audit](oracle-p4-auth-reference-integrity.json), not dependent on the damaged JSON:

| Gate | Result |
| --- | --- |
| Original custom dump SHA256 and12,400,017-byte size | PASS; unchanged |
| Current62table counts/ordered MD5 against prior frozen-restore public fingerprints | PASS;0differences |
| Both sequence values/is_called against the unmodified custom archive | PASS;0differences |
| Old quarantined Storage copy | PASS;73files/SHA256/bytes,0extras |
| New compatible Storage copy | PASS;73files/SHA256/bytes,0extras |
| New Auth/Kong/PostgREST | PASS containment; all stopped/no ports/restart=no |
| Original denied attempt1 retained | PASS |
| Additional password attempts / magic link | 0 / not requested |
| Original frozen source-verification JSON | **FAIL: overwritten** |
| Exact bundle recovery copy among known VM `.env.p4*` artifacts | None found |
| Complete P4 fidelity / password / session-RLS / two cycles / reverse / wipe | **NOT PASS** |
| P5 | Not started |

The retained dump and both physical Storage copies preserve the data; independent checks found no table/sequence/object change. These checks do **not** recreate the lost snapshot-bound source catalog/transport/bucket/settings bundle or waive full verification.

## Local repair and regression protection

- Journal writes now have a fixed literal destination under `/opt/ir35/config`, independent of `path`.
- Execute embedded audit code in a separate namespace; transfer only its result/read-only query helper, never global variables.
- Test the actual save-function AST with `path` deliberately pointing to a source artifact; prove only the fixed journal is written. Test namespace isolation with an adversarial colliding audit.
- Integrity hold blocks the new credential harness and compatible restore/API controller locally, before SSH or reading stdin. Launcher checks status before hidden Read-Host; do not open it while held.
- Auth diagnostics use strict known-message/error-code projection and request-ID filtering; arbitrary messages, email, passwords, JWTs/hashes and extra fields never escape. Raw live logs were RAM-only; Docker logging remains disabled.
- Read-only cloud anon key is also stripped from the SSH child environment. No cloud credentials transferred/persisted.

Verification: **225Linux helper tests**, **946Vitest tests/149files +199legacy checks**, strict TypeScript/full zero-warning ESLint, both PowerShell parsers and whitespace PASS. Source/history scan PASS across958tracked files. No assertions/timeouts/RLS/CSP or verification standards weakened; offline repair is **not** runtime recovery. New-head hosted CI is separate, not claimed green.

## Proposed owner recovery decision

Approve a **new read-only consistent cloud capture and separately journalled protected staging rehearsal**, retaining the original dump, damaged reference, old/new failed journals and quarantines as evidence. Never overwrite/re-label the old reference, reconstruct it from current data, or reuse its original hash for a new snapshot. Re-run the full schema/data/Auth/sequence/storage standard and prove the new reference cannot be written by the harness before resuming Auth tests. No production write, password reset or customer login.

The ONE additional password attempt remains unused and must stay hidden/owner-entered after repair and readiness proof. Sink-only magic link is still an extra signal, never a password-gate waiver. P4/P5 remain stopped until recovery is authorised and all gates actually pass. Exact **YES CUTOVER** is absent.
