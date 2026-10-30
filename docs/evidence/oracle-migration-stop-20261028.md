# Migration continuation — hard STOP, 28 October 2026

The owner-defined **third same-gate failure** has been reached in a new, credential-free GitHub CI fixture, NOT on Oracle. No fourth repair/push/gate/native action is authorised. No production, VM, DNS, provider, IAM, secret-value or customer-data change was executed during this continuation. SSH remains agent-loaded under the owner's no-lifetime policy; this interim stop is not the full-migration final handoff/cutover.

## Exact result and proposed next action

Draft [PR62](https://github.com/IR35careers/IR35/pull/62) is pushed through7ab8c2bd0d2ea49c08a58ddaa40ad22430e90120. [Final failed job](https://github.com/IR35careers/IR35/actions/runs/40701090610/job/122860783121), [write-once local stop evidence](oracle-p8-private-edge-ci-stop3-20261028.json), seal`12c5173b125b7fe653ff01b52408fc352982d6a13c1741a06b182d0c726ec1fa`.

Caddy adapt/validate and cleanup PASS. Five of six actual route cases PASS, including SDK401/401/200 and successful app Bearer preservation/Basic removal. The bad-Basic/valid-Bearer case correctly returns401 but lacks `Cache-Control: no-store` and `X-Robots-Tag: noindex...`; `Server: Caddy` also remains. The unused private-QA plan must not be activated. The deployed/original P5/P6 configurations were not modified or retested here.

Proposed ONLY: explicit config-only authentication-error handling with unchanged401/WWW-Authenticate, the same security/cache/request-ID headers and Server removal, retaining all existing assertions. This requires owner reopening; no fix has been implemented. The original2 Docker-adapt255 failures remain preserved and are not rewritten PASS; the final run got past that preparation and exposed this distinct response-header defect within the same full gate. No count reset or fourth workflow-triggering push.

## Phase status

| Phase | Current evidenced scope |
| --- | --- |
| P1–P4 | Historical approved staging PASS in drafts49–53; no redo or new VM/resource claim |
| P5 | Historical staging PASS, SDK401/401/200, draft54; no new activation |
| P6 | Historical standalone mock PASS152, draft57; no real acceptance or new run |
| P7 | Scoped source-configured email/Auth +73 signed Storage checks PASS, draft61; G3 CLOSED. Real Google/SMTP deferred |
| P8 | **INCOMPLETE / stopped at new CI gate.** Native write-browser/CDC/callback/restart/cleanup, encrypted backup/restore, exact reverse, monitoring and timed drills still required |
| P9 | Draft [PR63](https://github.com/IR35careers/IR35/pull/63) contains preparation/NO-GO runbook; no executed end-to-end staging dry-run or cutover |
| P10 | Not started; no cutover,14-day monitoring/decommission authority |

Completed source verification:1297 unit tests/176files PASS188.36s,199legacy,strictTS/fullzero-warninglint;48new transport/relay/browser tests included. Full final helper suite686PASS56.629s, [seal](p8-qa-edge-repair2-hermetic-01/manifest.json)`c932c901d12a4d9b61fbb4b97e677e53dcfec05f91cf32da67cc48e486e44c29`; late final propagation test6PASS0.138s. Source/history secret scan2022trackedfilesPASS. These do not substitute for native migration fidelity or a P8 signoff. Other hosted checks may still be running; no all-green claim.

Last authenticated OCI inventory remains27October's2OCPU/12GB,50+100=150GBlive,0volume backups,exactStandard0bytes and laggingGBP0. No new resources/cost-bearing service was created. This continuation did not re-audit billing and cannot certify a real-time£0 invoice.

## One remaining owner batch (no passwords/tokens in chat)

1. Reopen the precise config-only new QA-edge error-header repair and bounded rerun, or leave migration stopped. This is NOT production or cutover authority.
2. Resolve the existing backup age gate: public recipient with offline/password-manager identity custody and restore handoff, OR explicit single native hidden key ceremony. Private identity never on the VM or in chat.
3. Resolve the existing exact-one-VM/private-ir35-backups instance-principal IAM proposal for required backup read/create/delete-object/read-bucket access only; no overwrite/admin/other resources. No IAM has been added. This is not approval inferred from browser sign-in.

No repeat Auth export, test-account password, routine OCI API passphrase or time-based SSH prompt is requested. Google/DNS/live provider gates and exact **YES CUTOVER** remain later, separate gates. Old Vercel/Supabase projects stay intact; no merges or decommissioning.

This stop report and current instruction update are **local only**, not pushed: pushing would automatically run an unapproved fourth instance of the failed CI gate. The public PR receives a factual status comment instead.
