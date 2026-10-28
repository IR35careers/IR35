# P8 disposable writable-QA preparation — source verified, NOT activated

This implements the fixture preparation needed for actual authenticated browser/save/mock-apply testing. It does **not** replace that required QA with a config test, standalone worker smoke or the earlier read-only browser gate. No new native slot, database, file, container, secret, queue or service has been created by this source work.

## Implemented boundaries

- A distinct `_p8_webqa01` database name, never the pristine/P5 database or the consumed `_p8_upgrade01` rehearsal. Exact annotation and zero connections are required before the owned database can be dropped; no forced disconnection or replay on an ambiguous create.
- Full clone baseline before the exact reviewed025 migration. Keep raw upgrade deltas, the unchanged 552 privilege comparison, RLS/policy equality, revoked direct packet writes, all ten delivery capabilities, sequences and actual eight queue-role/transport denials. Upgrade deltas are not migration-parity exceptions.
- Exclusive Storage copies with exact bytes and extended attributes, source verification, mode400 sealing, SHA-only path evidence, inventory coverage and no overwrite. The native source remains untouched.
- Existing Oracle-staging credentials only, in exclusive mode600 files owned ir35. No key generation, cloud credential copy, values in command arguments or logs, or inherited provider settings. Web gets only the producer queue URL; worker gets only the queue-owner URL and no direct Supabase/service/Auth/provider credentials.
- Unique backend container names; no `kong`, original P5 or public fallback. Kong's existing consumers, ACLs, plugins and routes are preserved while exact Auth/REST/Storage upstreams are rewritten. No public port, Studio/meta service, host network, Docker socket, Caddy key mount or network creation.
- The two native images must match the real679dc8c image proof. The worker requires its explicit mock-only profile and entrypoint; preparation does not run queue setup or a consumer. All acceptance=false/mock/sink/one-browser restrictions remain.
- The unchanged source-bound P7 mapper supplies Auth configuration/templates/subjects. Raw Compose env-file parsing plus an exact in-memory resolved-subject comparison prevents punctuation or `$` interpolation from changing source subjects. Existing Compose >=2.30 is required; no upgrade is attempted. [Docker's env-file format documentation](https://docs.docker.com/reference/compose-file/services/#format).

## Test evidence

| Gate | Actual result |
| --- | --- |
| Initial preparation subset | 22 PASS / 1 ERROR; retained [original failure](oracle-p8-webqa-storage-order-offline-20261028.json) |
| Single offline repair | Apply xattrs through the same writable descriptor before sealing400; existing byte/metadata/mode/replay assertions unchanged |
| Repaired subset | 23 PASS, 2.214 s |
| Full empty-HOME suite before final raw-subject additions | 662 PASS, 98.36 s; [manifest](p8-webqa-hermetic-01/manifest.json), SHA `2e913bfb97fce64e3743d8f6bcee3b03daa4577e7243bf127cdc15c66b8d1b99` |
| Final full empty-HOME suite | **664 PASS**, 62.78 s; [result](p8-webqa-final-hermetic-01/result.json), [manifest](p8-webqa-final-hermetic-01/manifest.json), SHA `ee4473354670f0aa0d1d24c7925451adc3c6b51e610ac2f56482a14ae1bfb299` |

All 26 new tests are included in the final suite. No `.ir35` directory before/after; no private state copied, real keys supplied, VM calls or removed tests. The dependency-graph test explicitly refuses private state, sockets and subprocesses; other regressions may use local synthetic fixtures. The 73-file copy regression uses **synthetic temporary files**, not customer files or a new native Storage PASS. Actual prior native image/data containment is recorded separately in [the image report](oracle-p8-native-images-20261027.md).

## Next native gate — not yet executable

The bounded create/test/cleanup controller, private protected fixture edge/tunnel, image/native-manifest and network/headroom attestation, owned service startup, fixture job seeding, queue setup, real browser flows, callback/restart/Realtime checks and complete cleanup still need integration. Do not invoke the preparation methods ad hoc or leave a clone exposed/running. There is deliberately no preparation CLI or automatic startup.

The historical full HBA verifier requires the original fourteen connectable databases and exactly112 logins. Do **not** filter its results, change112 or waive the extra database: run original full containment before creating and after removing the owned QA clone, with separate actual eight-role/transport denials while the clone exists. Every original hash/assertion remains unchanged.

Realtime is not yet routed to a separately owned QA tenant; it must never fall back to the old stack, and404 is not a passing Realtime check. Current full-health flags remain truthful rather than faking readiness.

P8 remains incomplete: browser-write QA, encrypted backup/restore, exact managed-Storage reverse path, monitoring and timed recovery drills remain. The previously batched age-key custody/bucket-only instance-principal decisions are unchanged. P9 preparation/NO-GO only. All PRs remain draft/unmerged; no production, provider, DNS, IAM/network or cutover change.
