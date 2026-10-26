# P8 memory preflight FAIL — stopped before load, no repair/retry

Separate staging [draft PR62](https://github.com/IR35careers/IR35/pull/62), based on unmerged draft PR61. No merges, approvals or production deployments.

The fixed `readonly-load-01` slot is consumed. Its manifest SHA256 is `8c89ba466ce78bac5cc22c1755bf169878b73b25bc8a608914f5da15cc885da2`; [exact result](p8/readonly-load-01/01-load-memory-edge-containment-result.json) and [manifest](p8/readonly-load-01/manifest.json) are write-once. No slot reset, limit/configuration change, new resource, restart, real email or employer submission occurred.

| Gate | Result |
| --- | --- |
| P7 source-configured email/Auth, signed Storage, full containment | Scoped staging PASS; real Google/SMTP deferred, see P7 signoff |
| P8 offline load harness |578 fresh-home tests PASS/41.484s before native call |
| P8 native initial memory sample | FAIL `ContainerMemoryBudgetExceeded_Abort` |
|50-user/200-request load | NOT STARTED; p95 unavailable, do not fabricate it |
| Native full containment after the failed preflight | PASS62counts/orderedMD5/Auth,2sequences,3approved exceptions,552privileges+queue roles,73Storage hashes and112fresh HBA checks |
| Encrypted backup/upload/restore/reverse-sync | NOT PROVEN; no timer, public age recipient or age executable at the known readiness locations |
| P9 runbook/dry-run | NOT COMPLETED; no phase advancement after failed native gate |

## What failed and what is not yet known

One baseline sample reports `ir35-staging-meta-1` summed process VmRSS152,690,688bytes (145.6MiB), greater than its configured134,217,728bytes (128MiB). OS MemAvailable was9,410,158,592bytes (well above2GiB). Fifteen running containers were sampled; no load requests or monitoring thread started after this initial guard failed. This does NOT prove a kernel memory-cgroup overrun: summed process RSS can double-count shared mappings and is not the same quantity as cgroup charge. No kernel-memory/OOM diagnosis has been run, and no OOM or real overrun is being asserted from incomplete evidence.

Proposed NEXT action, not executed: ONE read-only diagnostic on the same meta container, capturing configured limit, State.OOMKilled/restarts, cgroup-v2 `memory.current`, `memory.peak`, `memory.events`, selected `memory.stat` counters and process `smaps_rollup` Rss/Pss totals only. No environment, argv, labels, secrets or customer data. This distinguishes sampler accounting from a genuine memory problem. Report before any fix/rerun. Do not change limits, assertions or timeouts merely to obtain PASS.

## Single future owner batch (no windows/prompts opened)

1. Decide the bounded read-only memory diagnosis above; native P8 remains stopped meanwhile.
2. Fresh Oracle browser sign-in is required for authenticated free/usage/cost/Object Storage/monitoring checks. Refresh already failed once; do not loop. SSH is still agent-loaded; time alone is not a reason to prompt again.
3. Backup public age recipient/approved offline private-key restore mechanism are missing at the known locations. Do not search for private keys or generate/store a private identity on the VM. Age installation, encryption/upload and full restore still need implementation and proof. No secret values in chat.
4. Determine existing VM-to-bucket permissions read-only after sign-in. If absent, propose an exact-one-VM/one-bucket instance-principal scope; current no-IAM-change rule prevents creating it. No stored API key/PAR workaround.
5. Google URI/real provider and real SMTP proof remain deferred under the owner's no-provider/no-real-mail order; exact entries are in the OAuth plan. G3 is CLOSED; no further Auth export/manual-copy request.

Historical Always Free allocation: one2OCPU/12GB A1,50+100=150GB live storage. Current Object Storage/version/multipart usage, combined<=5volume backups,8GB owner cap,API request allowance and billing cannot be freshly attested without OCI authentication. No new paid service/resource or production change was made. Cutover remains NO-GO, exact YES CUTOVER absent.
