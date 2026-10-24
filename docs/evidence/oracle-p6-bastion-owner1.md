# 25 October — one bounded Bastion recovery: STOP, containment PASS

Owner scope: one short-lived session on the existing Bastion and existing VM;
no retries, IAM/Bastion/network changes, secrets, production or cutover.

| Gate | Result | Evidence |
| --- | --- | --- |
| Read-only preflight | PASS | [preflight](p6/bastion-owner1-preflight.json), `fa53223a933ce0db59b3b825abdacd82d30ec8c8f589fc6a9a032cffcf0d95c7` |
| Existing VM, exact client /32, original restricted network/VNIC and gateway continuity | PASS | [one-shot journal](p6/bastion-owner1-session.json) |
| Fresh exact free-tier storage accounting | FAIL — exact byte evidence missing | Same journal, `b18e0a69a7039beb80d561ab0900e6323f0a910d76c8aadc33c3c815e9eb3b3f` |
| Session creation/closure | None created; none to close | Creates0, Bastion/IAM/network changes0, no retry |
| Open 23:40 probe intent | Reconciled: NOT_RUN | [read-only safety verification](p6/bastion-owner1-post-stop-containment.json) |
| Worker | Still stopped; original image; restarts0 | Same verification |
| Full source/pristine/app containment | PASS | Native seal `8075e63b8ee8cc367ce7149046c8cecb399f103c5ab658a5786c872b61042673`; local seal `7c91ac8396b4095ef296ffffbeee92be2dd5ccef64f462382ed500c94c1b9edc` |
| Local regression/source checks | 343 helper tests PASS; source/history scan PASS | No assertions/timeouts waived; hosted CI is separate |

## Exact failure and diagnosis

`Approximate Object Storage metadata is not exact byte evidence.`

The legacy `resource_audit.inventory` reads `approximate-size` and
`approximate-count` from Bucket GET and sets `exactBytesProven` only when
`bucket_count == 0`. There is now an existing bucket, so that older generic
inventory cannot prove an exact total. `storage_budget.reconcile` correctly
refuses it. This is a missing proof in the tooling, **not** a measured charge,
an object-byte mismatch, or permission to waive the guard.

The earlier P1 empty-bucket proof was separately collected and is historical;
it cannot substitute for a fresh exact inventory before a create.

Proposed future repair: enumerate all inventoried buckets/objects with complete
pagination and exact size/tier/version/upload accounting, retain private/name
redaction, independently test it, and feed that proof to the unchanged caps.
Never mark approximate metadata exact or loosen the 8 GB/Standard-only limits.
No repair/retry was executed after this failed attempt.

## Read-only safety verification after STOP

The current public IP was already allowed by the original owner /32 rule, as
independently verified in the preflight. One **read-only**, original-host-key-
pinned direct SSH inspection fulfilled the requested after-work containment;
it was not a Bastion retry, did not bypass a create gate, and made zero OCI
calls, session/probe creates, worker restarts, data/secret/config changes.

The old probe helper creates `07-network-diagnose` before it can create its
credential-free container, and never removes that stage. Both that stage and
the exact owned probe container are absent. Therefore it never reached probe
creation: `NOT_RUN`, `replayed=false`. No old intent/log was edited or reset.

Both pristine and app reference databases independently retain:

- 62 exact table counts/ordered MD5 fingerprints, including Auth/password bytes;
- 2 sequence states, exact schema except the 3 previously approved extension
  owner fields, and both separately approved queue roles;
- all 552 existing app-role privilege checks and unchanged source-role values;
- all 73 Storage SHA256 checks, old manifests and original Caddy files.

Additional queue-role customer-access checks total354 with0 unexpected access
across operational/pristine/app databases. No new privileged identity or grant.
Mock acceptance=false, original mock/sink settings and rollback files unchanged.

Private write-once logs stay outside Git in the existing owner-only key area
and VM `/opt/ir35/.env.p6-bastion-owner1-20261025` (metadata/hash evidence only).
The old failed controllers, counters and sealed artifacts remain unchanged.

P6 is **not complete**. Do not advance P7/P8/P9 or repeat recovery under this
consumed approval. All PRs stay draft/unmerged; exact `YES CUTOVER` is absent.

Reference: [Oracle Bastion service limits/no service cost](https://docs.oracle.com/en-us/iaas/Content/Bastion/Concepts/bastionoverview.htm#limits).
