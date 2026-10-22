# P4 test-account login — FAIL / owner decision required

21 October 2026. One actual named-account password request to the private Oracle Auth container returned **HTTP400**. The owner finished the hidden prompt, but this was **not a successful login**. No password/OCI/SSH prompt has been reopened or credential request retried.

| Gate | Result |
| --- | --- |
| Exact Storage repair | PASS;74unchanged migration hashes/native ARM pin,73files/signed URLs/anon+authenticated RLS, original proof retained. |
| Auth startup / pre-login fidelity | PASS; actual private health and all62table/2sequence/schema/security checks matched before using the credential. |
| Password grant | **FAIL HTTP400**, loginAttempts1, durable LOGIN_DENIED; error body/provider error_code was not retained. Do not assume a proven password mismatch from the status alone. |
| Read-only named-account checks | PASS: one confirmed email identity, password hash present; not SSO-only/anonymous/deleted/banned. Email provider enabled, correct isolated DB and SMTP sink. No customer-account diagnostic. |
| Post-attempt full verification | PASS all62ordered row fingerprints,2sequence states,3752schema/327supplemental/552privilege checks and exact approved owner exceptions;0data differences. |
| Isolation / failure hold | PASS owned test Auth exited0/stopped, no public ports, no source writes/reset/retry. Original attempt counter retained. |
| P4 / P5 | BLOCKED; do not wipe/replay/advance. Reverse/two complete cycles/wipes remain, P5 not started. |

Evidence: [denied attempt/read-only flags](oracle-p4-login-denied.json), [post-attempt full audit](oracle-p4-storage-compatible-post-audit.json), [successful Storage repair](oracle-p4-storage-compatible.md). Snapshot equality means no migration corruption was detected; it does not explain the missing Auth error detail or waive login verification.

The launcher now reads the durable state **before** asking for a password; the Python boundary independently refuses before reading credential stdin unless READY_STOPPED. A regression proves LOGIN_DENIED cannot read stdin or invoke another credential operation. No credential was recovered from memory, logged, saved or re-used. Temporary Auth operational env contains only fresh staging service settings, not the entered test password, and remains600/ir35 on the VM for reconciliation.

Owner batch (no secret in chat): choose either a new explicitly requested hidden-password attempt with the correct **named test-account** password, preserving attempt1/history; or a staging-only magic link delivered to the SMTP sink. The latter would verify a different login method, **not turn the failed password test into PASS**; password-grant verification still remains required before final staging signoff. Never reset a cloud password, alter hashes, use another customer, clear the journal or change production settings. No alternative flow has run.

All PRs stay draft/unmerged. No cloud/Vercel/DNS/IAM/billing/worker-acceptance or cutover change. Literal YES CUTOVER remains absent. Prior head3a10b7d has all10hosted checks SUCCESS; follow-up-head CI is separate.

Follow-up verification:217Linux helper tests PASS, including denied-state/no-stdin/no-remote-credential regression; PowerShell syntax and actual read-only --status PASS. Full native post-denial62row/2sequence/schema/security and old73file/original9service protection audits PASS. Earlier full946Vitest/149files+199legacy/types/lint results are retained; no new full TypeScript-suite run claimed for this Python/PowerShell guard-only change. Source/history scan and whitespace checked before the follow-up commit; no password attempt was repeated.
