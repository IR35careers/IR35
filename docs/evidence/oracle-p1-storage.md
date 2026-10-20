# P1 storage reconciliation and routine authentication — 20 October 2026

No provisioning or production change is claimed by this document. **P1 stopped on a failed installed-CLI wiring check after its one repair.** Routine authentication, agent and authenticated resource audit are completed, not the phase.

| Budget | Approved workload | Separate free allowance / safeguard |
| --- | --- | --- |
| Live boot+block | 50+100 =150GB, tenancy-wide | 200GB combined in home region; no paid/trial-only volume or excess performance/autotuning |
| Volume backups | At most five total boot+block backups | Independent count allowance; unused50GB live space is not backup capacity |
| Object Storage | At most8,000,000,000 bytes, including ciphertext/manifests/upload overlap | Standard only, auto-tiering off; conservatively10GB Standard during trial,20GB combined after trial |
| Object requests | Stay within50,000/month free | Upload/prune/restore traffic counts too; track before enabling backup automation |
| Billing | No paid resources/plan upgrade | £1 budget is an alert, not a cap; lagging/empty cost data is not real-time£0 proof |

Official source re-read20October: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). Its trial Object Storage wording includes different tier/combined summaries; use the stricter explicit10GB Standard allowance and owner's8GB cap, never trial credits. No reliance on social-media claims. Existing gross boot estimator£1.60/month excludes tier pricing; eligibility and actual tenancy allocations must be reconciled, not dismissed or called a bill.

`storage_budget.py` is a pure prospective check, **not an executor**: requires inventory<=5min old, exact byte proof (empty buckets only until exact object inventory is implemented), home London/Free Trial and complete lag-aware cost metadata; aggregates current plus proposed live/backup/object usage. Positive reported usage is not canceled by credits. Missing data, other tiers and cap breaches stop. Fresh per-create account/eligibility/quota evidence and durable intent/read-back are still required.

## Auth evidence and failure record

- Closed old API-passphrase process. Routine auditor no longer calls `unlock_api`/passes `OCI_CLI_PASSPHRASE`; legacy Windows unlock launcher now refuses execution. Existing encrypted API/Ed25519 files retained unchanged.
- Routine CLI uses `--profile ir35 --auth security_token --region uk-london-1`. Terraform, if introduced, must use `auth = "SecurityToken"` and `config_file_profile = "ir35"`; no Terraform execution is claimed.
- Browser-based CLI session **actually completed**, followed by successful local safe session validation. No API key uploaded/revoked by this change. Short-lived token/session signer are outside Git, directory700/files600. Existing long-lived encryption is not removed. No password, code, token or session URL printed/captured; quiet callback removes vendor console-token logging and binds127.0.0.1 only.
- Two WSL-to-Windows launch failures stopped at `SystemExit` in vendor wrapper; local diagnostic proved `execvpe(...powershell.exe) failed: Exec format error`. One repair: native Windows parent launches browser from a private child pipe; it does not enable WSL interop, proxy/stealth/headless mode or automate login. Actual sign-in then PASS. No further auth retry needed.
- Before each active OCI call: validate profile/file ownership/modes/symlinks/expected public identity; refresh once if<10min remain, no API fallback. Original browser start time imposes24h ceiling even after refresh. Failure/daily expiry requires owner browser sign-in. Idle/unattended refresh is not enabled.
- Read-only auditor's first signed run stopped on OCI empty-list output: pinned3.95 `cli_util.render` emits no JSON for a successful empty list. Narrow repair permits zero-byte stdout only for named `--all` list operations with exit0; required objects/cost/partial JSON still fail. Tests preserve malformed/partial-output failure cases. Actual rerun **PASS at08:06:43UTC**: root/all active compartments and three ADs, zero VMs/boot/block volumes/backups/VCNs/buckets, zero A1 usage, existingGBP1 budget+100% ACTUAL email alert ACTIVE. Current-month lagging cost report has zero rows, not real-time£0 proof. [Metadata receipt](oracle-p1-resource-inventory.json).
- Further actual shape reads: AD-1 andAD-3 advertise flexibleA1 `LIMITED_FREE`; AD-2 does not listA1 and has zero available A1 limit. Larger available41OCPU/277GB trial/service limits inAD-1/3 are not the owner's entitlement. No capacity launch attempt.
- WSL per-boot agent is actually running with an owner600 socket in a700 directory. Owner loaded the existing protected Ed25519 key once; independent `ssh-add -l` fingerprint check reports `agentReady=true`, `keyLoaded=true`. No passphrase obtained by the agent code, saved to disk/env/args/logs, or repeated. Windows service remains untouched; WSL agent is the owner's allowed alternative. No VM SSH connection is claimed. Retain this agent; do not restart WSL or clear it to provoke another prompt.

## Local verification

**51 actual Linux unit tests PASS**, including the final hold regression proving the real entrypoint invokes neither authentication nor creates (crypto/hidden-input/scope, SecurityToken refresh/day/redaction, agent reuse/no-repeat, storage boundaries, durable intent/read-back/collision/unknown-outcome). TypeScript and32capacity/planner tests PASS. Failed installed-CLI quota probe was not retried after its documented repair; these unit results do not reopen the gate. These are not provisioning/billing/host-health tests.

Source/history778tracked files, PowerShell launcher parsing, whitespace checks and static Vercel main/Oracle deployment holds PASS. No new release workflow or production setting; final-head hosted CI is separate and remains to observe.

## Failed P1 preflight — no create enabled

`p1_control_plane.py` prepares only a compartment and restrictive single-AD quota specification, plus exclusive600 journal/fsynced intent/independent GET/no ambiguous retry. CPU/memory/storage families default to zero outside the one selected AD; it does not accidentally allow2/12/150 in **each** AD. Root/unrelated compartments are not modified. No executor invocation or journalled create occurred. No VM/network/storage/Bastion adapter is enabled.

Actual installed-CLI wiring probe: browser-parser and quiet callback tests PASS, compartment payload reaches the intercepted client, but quota payload fails **`NoSuchCommand`**, client call count0. Failed check twice; documented single repair (isolated parser process per service, like real CLI invocations) **still FAIL**. Stop per owner failure rule; real entrypoint now explicitly refuses all creates. No more automatic repair/retry.

Proposed next repair, not executed: the pinned vendor `oci_cli/dynamic_loader.py:59` loads services using **`sys.argv`**, not just Click's `args`. The probe's process argv contains its own `--payload-wiring` selector, so service registration is likely wrong. Align actual vendor process argv/import order with the tested command, retaining interception before every cloud client; require all assertions PASS before reviewing removal of the hold. Do not weaken/skip the test or use an API-key fallback. This is a local verification failure, not an Oracle API/capacity rejection.

[Session authentication documentation](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/clitoken.htm): default token lasts one hour; valid sessions refresh within the24h browser window. Owner login is still required, never simulated.
