# P8 real protected read-only browser — PASS, not whole-phase signoff

Source controller commit `84e1bc36042bcb70f05df577ebb9e312d764917c`. Actual pinned Chromium149.0.7827.55 ran headed on the owner's Windows machine against the existing Oracle staging application. New ephemeral context, no demo API/server fixtures, no HAR, screenshots, videos, trace or stored browser state. Existing VM Basic password travelled only through captured SSH/stdin IPC/RAM, never arguments, environment, files, evidence or console. The VM, Caddy, container images/configuration and credentials were not changed.

**Final gate PASS**, [result](p8/browser-readonly-01/result.json), manifest `62fe4e38a9ecd4e865dc1dab95f9c4d2439641058074cd80c783effca066f4cd`. Exclusive slot01 is USED; do not replay it or reset its evidence. Every navigation records intent/expected/result; failures have a separate bounded metadata-only record. Manifest hashes are checked before every artifact write.

| Browser check | Actual result |
| --- | --- |
| Jobs / tools IR35 status / take-home / account | Each200, exactly1H1, no horizontal overflow at1440px, same staging origin, CSP/noindex/no-store present |
| Server-rendered jobs | Actual HTML contains a job-detail anchor before relying on hydrated DOM |
| Search filter | Real UI fill produces real Oracle-backed GET200 with jobs[]/total0 for the dedicated no-match query; no mocked search response |
| Job detail | Actual discovered listing200/1H1/same staging origin |
| Gate cookie | Exactly1 `__Host-ir35-staging`, Secure, HttpOnly, SameSiteStrict, Path/; value never recorded |
| JavaScript/CSS | Actual script+stylesheet responses200, live filter proves client hydration;0page errors |
| Request boundary |148actual server reads, ALLGET/ALL200;13other attemptedGET destinations blocked before forwarding (13unique path/URL hashes only);0followed redirects/0WebSockets/0write methods sent |

Requests were intercepted to enforce the boundary, then fetched from the ACTUAL staging server with zero redirect following/retries and the actual response returned to the browser. This is not response-fixture mocking. Only fixed safe staging pages/assets/search/SDK reads are permitted; generic GET APIs (cron, recovery, verification) and external URLs are refused. Service workers are blocked so they cannot bypass routing; WebSockets are closed before a server connection. SDK Bearer/cookie semantics stay unchanged, edge Basic applies only outside SDK routes. No provider login/real mail/employer submission occurred.

The13blocked requests are not evidence that external images or every linked asset works. No mobile/authenticated browser-write or real Google coverage is claimed. This completes the public/read-only browser gate, not the remaining signup/login/recovery/save/mock-apply/account-session flows on a disposable writable clone.

## Full post-browser containment — PASS

[Original complete verifier result](p8/browser-readonly-01/containment-result.json), not a new reduced comparator:

- Pristine and P5 application copy:62table counts + orderedMD5 each;27Auth table/hash checks;2sequence states each.
- Schema/security: ONLY3approved extension-owner exceptions;552original app-role checks unchanged, approved queue-role additions and source roles unchanged; retained PUBLIC function finding stays recorded, not hidden.
- Storage:73objects each, SHA256 match, original manifests/Caddy files unchanged.
- Fresh actual queue login boundary:112checks,8queue positives/104application rejects,0function calls; no new containers, reload/restart or config change.
- Source/pristine/P5 fixture writes all0. No OCI/IAM/network/DNS/Vercel/Supabase cloud/Google/key or paid-resource change.

Pre-run strictTypeScript/zero-warninglint/1084unit/199legacy PASS;609helpers PASS in freshHOME/no.ir35/no private state72.274s, [source evidence](oracle-p8-browser-source-checks-20261027.json). The original offline bundle-substring test defect and repair remain recorded, with no historical assertion, timeout, data hash or catalogue edit. No P7 used Auth slot was replayed.

P8 remains INCOMPLETE: writable disposable-clone browser QA, actual age-encrypted DB+Storage automated backups/upload/restore, managed-Storage zero-loss reverse path, monitoring/disk-alert installation and timed cutover/rollback drills. Existing backup key-custody/conditional one-VM-bucket IAM owner batch remains unchanged; no new question/credential request was issued during this gate. P9 stays preparation/NO-GO only. Exact YES CUTOVER remains absent.
