# P6 bounded recovery — PASS, 25 October 2026

This is recovery signoff, not completion of the worker/Realtime/scheduler phase.

| Gate | Actual result |
| --- | --- |
| Existing SSH identity | One native hidden `ssh-add -t 4h`; fingerprint matched; 14,052 seconds remaining at recovery start |
| Browser SecurityToken | 2,295 seconds remaining, above owner-approved 1,800-second minimum; compartment GET ACTIVE |
| VM/free envelope | Existing London LIMITED_FREE A1, 2 OCPU / 12 GB; 150 GB boot+block; zero volume backups |
| Object Storage | Fresh exact full pagination, stable two passes; Standard/private, 0 bytes; unchanged bucket |
| Cost report | Lagging GBP net/positive both 0; **not** real-time zero-billing proof |
| Network | Original owner /32 and private Bastion /32 only for SSH; no broad IPv4/IPv6 SSH; unchanged |
| Session | Exactly one, TTL 1,800 seconds, existing VM private SSH only; independently closed |
| 23:40 probe | NOT_RUN: durable stage and exact owned no-mount probe absent; no replay |
| Worker | Original image, exited, zero restarts; no restart during recovery |
| Containment | PASS inside session **and after closure** over original pinned owner-only SSH |
| Baseline | Each pristine/app clone: 62 table counts/ordered MD5, Auth hash parity, 2 sequences, schema with only 3 approved owner exceptions, unchanged 552 privileges, 73 Storage byte hashes |
| Queue roles | Two approved additions recorded separately; original roles unchanged; 354 additional table/column access checks, zero unexpected access |
| Offline source gates | 367 helper tests and source/history scan PASS; no relaxed assertions/timeouts |

[Full sealed recovery](p6/bastion-owner1-session-four-hour.json), SHA256 `a6626c6c3cd032c1c5f619444d99e147a562066dc62a22ffe917a8a23f017de3`.
[Inside reconciliation](p6/bastion-owner1-reconcile-four-hour.json), native SHA256 `fd882f4b5ea912ca748a1e21d847fe1ba0c56a317125230a01e7a881dec5919e`.
Post-close containment native SHA256 `aa1f7af86a12a01b1dce64326513aea27bd4e1ab9fd0d68219b21c5285c6c342`, embedded in the full report.
[Fresh pre-create exact storage audit](p6/exact-storage-04-bastion-eligibility.json).

No IAM, Bastion configuration, network rule, bucket/object, operational secret, worker restart, customer data, production, DNS, Google, Vercel or Supabase cloud change. All older failure artifacts/counters retained. No additional recovery session is authorised or needed. Existing native agent window remains open; check key/token budget before long runs, never request another passphrase automatically.

Next: owner-approved P6 isolated credential-free port diagnosis, bounded mock-worker health repair/lifecycle/Realtime/heartbeat/schedules, then P7 and P8 with full containment after every phase. P9 is preparation and staging dry-run only. All PRs stay draft/unmerged; `YES CUTOVER` is absent.
