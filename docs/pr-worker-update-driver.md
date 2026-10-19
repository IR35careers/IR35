# Serial worker update and recovery interpreter

## What and why

Stacked on draft PR #38, itself dependent on #36. Connects the real journal, host adapter, registry verifier and owner-private files into one bounded execution/recovery loop. Default loaded ports are actual WorkerHost/WorkerRegistry/WorkerFiles, not simulated deployment defaults. Every drain/replacement/resume decision is durable before its effect; acknowledgements alone never confirm success. One driver instance runs once; a new invocation reloads durable state.

New releases require exact signatures/immutable tags, forward ancestry from the stable release and a durable attempted-release high-water mark, and reachability on this public repository's main branch. GitHub comparison requests use bounded page-two metadata, not patches or the last item in a paginated commit list. No extra credential scope or API key is requested. Equal/downgrade/diverged/unreachable/private/renamed/unknown responses stop before selection. Actual read-only GitHub calls confirmed page-two relationship metadata and rejection of the unmerged host branch as main ancestry; this was not a signed-image or deployment test.

The private journal is explicitly **version 2**, with mandatory highWater artifact. No host journal is installed yet. Version 1/missing history fails closed; this code never silently invents a replay baseline, auto-creates a journal, migrates a private file or resets release history. A busy never-rejected image may retry; an older attempted release cannot be replayed after later failed attempts, nor can the same release SHA acquire a different digest. Rollback remains an explicit pre-resume transaction to the verified prior artifact, not an ordinary downgrade.

## Recovery and safety

- Keeps original ten-minute drain and two-minute launch/health/activation deadlines across durable reloads. Bounded polling and finite steps detect frozen/invalid/backwards clocks. A backwards clock on a positively owned original drain can arm its original resume; it never authorises a replacement.
- Stops every original consumer through the existing maintenance contract and waits for zero actual handlers AND zero database-wide submitting jobs. In standby, another Vercel runner's global submission is not confused with a local consumer: replacements still require global zero; idle standby confirmations require local handler counts zero.
- Lost drain acknowledgements use the same UUID and at most two attempts per invocation. No drain retry is signed in the final authenticated-command validity window; the host enforces this AFTER file reads/fsync delays at its actual signing timestamp. An idle snapshot alone cannot prove a lost drain was canceled: that deadline case retains its UUID as a failed intent requiring human reconciliation, never a falsely confirmed abort.
- Positive pre-selection recovery may reissue the same persisted launch before its original deadline. After image selection is written, it never blindly repeats Compose. An ambiguous old generation after selection stops for human reconciliation. A positively unselected failed launch can resume the original paused generation and records that candidate rejected.
- A failed, never-resumed exact candidate can restore the previously prepared signed image under a different paused boot UUID. Failed rollback stops; it does not keep recreating. After any durable candidate-resume decision, rollback is forbidden because an application may already be in flight. A lost resume acknowledgement is confirmed from the exact actual idle generation, not a fabricated receipt.
- Recovers an already committed boot pause by the same committed operation, without selecting another image. Foreign generations/configuration, failed state, uncertain journal persistence and unavailable proof stop safely. Owner runner/acceptance changes are never silently rebound or undone.
- The fixed-directory loader reads the existing private v2 journal, checks the prior canonical state before each write, uses the existing fsynced operational-file writer and redacts parsing/loading errors. This compare-before-write does **not** replace the mandatory shared Linux flock or protect against root/same-UID interference outside it.

## Tests and limits

145 focused execution/journal/host/ancestry/maintenance tests pass at the latest combined checkpoint, with strict types/lint checked separately. Execution tests use the real journal and maintenance controller with controlled lifecycle/signature/registry ports and a virtual clock. They are NOT actual Docker/cosign/GHCR/Oracle replacement or rollback evidence. They cover both modes, busy/global work, dropped/lost acknowledgements at each durable phase, pre/post-selection failures, unhealthy candidate/rollback, foreign generations, configuration races, clock errors, repeat/concurrent invocation, committed boot recovery and replay guards. No new skip, tolerance or security exception.

Final local release verification passes **1,021 unit tests/141 files + all 199 legacy checks, strict types and zero-warning lint**. Source/history scan passes for **716 tracked files**. Audit retains only the two existing exact owner-approved exceptions expiring 29 October; no new waiver. Final-head CI remains required. Existing native ARM CI exercises actual Docker selected fields/local socket/unsigned-local-image refusal, mock browser, separate-role Postgres standby and real HMAC maintenance; it does not turn the controlled interpreter matrix into a signed physical update result. No UI/screenshots apply.

## Not installed or enabled

Still required: shared flock acquisition/verification and operator-edit wrapper; exact signed bootstrap and legacy-history handling; host Node/cosign/auth installation; executable CLI and five-minute systemd timer; actual Linux/signed-container recovery/failure matrix; OCI account/Always Free eligibility, VM/Bastion/SSH/health/billing evidence; external heartbeat alert; controlled staging and literal YES CUTOVER. Nothing here claims O0.5, Phase 0 or the full delivery objective complete.

No production database migration, RLS/CSP change, new dependency, secret, paid service, OCI resource, registry publication, timer enablement, production environment setting or cutover. Worker flags are not changed. No real employers are contacted. Test data is fictional; later staging uses only mock ATS and anvesh.mannuru+ir35test@gmail.com.

## Human review / verification

Review dependencies in order and retarget/revalidate after their human merges. New main protection/CODEOWNERS is pending PR #37; do not bypass checks or self-review rules. The owner/CLI author-account choice remains unanswered, so no other account or credential is assumed. No automatic approval, merge or PR closure.

Run npm run verify:release and inspect the exact-head native ARM/security/code/build/browser results. Review driver tests at every injected crash phase, verify original UUIDs/deadlines/highWater survive, and confirm no image/flag writes on uncertain activation. Do not activate a timer from these source results. Later, after verified free-host bootstrap/credentials/shared lock, exercise actual signed image success, every failure/rollback and restart in standby and report real SSH health. No Vercel UI preview is applicable to this host-only change.

Primary interface: [GitHub commit comparison and pagination](https://docs.github.com/en/rest/commits/commits#compare-two-commits). The exact metadata shape was also checked read-only against this repository.
