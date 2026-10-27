# P8 disposable025upgrade rehearsal — PASS, not application QA or cutover

Exact source `f8c0cf164e5055a713f0035c7230dbe3556fdd33`; [native result](p8/disposable-upgrade025-01/upgrade-result.json), [manifest](p8/disposable-upgrade025-01/manifest.json) SHA256 `128bea3d6c66e67bdf1b6483503fccf079c6262951dd41654fa6fec2aaf8237d`. Slot01 is USED; do not replay or reopen the destroyed clone. This implements the owner's previously approved **separate-copy** schema-upgrade test, not a cloud/pristine/P5 migration or a fidelity waiver.

| Gate | Actual result |
| --- | --- |
| Original protected copies before work | Full62table orderedMD5/Auth/2sequences/3approved owner exceptions/552original privileges+queue roles/73StorageSHA/FRESH112HBA PASS |
| New uniquely owned database clone | Created from the verified pristine snapshot; full original clone fidelity PASS BEFORE upgrade |
| Queue isolation on clone |8actual denied logins before and8after, including Docker/private/local/IPv4/IPv6 paths;0function calls |
| Exact committed025SQL | SHA256 `39fa06a4da6a8528ee0419d5fad65e36f759fd51581ec90182e6082bfce1a8e1`; applied ONCE to clone in its own transaction/ON_ERROR_STOP,0.270s |
| Required capability inventory | ALL10columns/types and10functions present after upgrade, no missing/wrong types |
| Data review | Unchanged original fingerprint code reads ALL62tables/current columns;59unrelated tables including Auth/Storage exact; raw deltas on the3intended application relations retained |
| Security review | RLS enabled/forced flags and every policy unchanged; existing552effective entries not broadened; authenticated packet INSERT/UPDATE revoked,0direct writable packet columns;30new function/role entries within reviewed025scope/no grant option |
| Raw schema delta | ALL66object/name/before/after hashes retained in result; no suppressed catalogue differences or source-baseline edits |
| Cleanup | Exact generated name+ownership annotation+0connections checked; only owned clone dropped/read back absent |
| Original protected copies AFTER cleanup | Same full62MD5/Auth/2sequences/3exceptions/552+roles/73Storage/FRESH112HBA PASS; source/pristine/P5writes0, original Caddy unchanged |

The deliberate upgrade changes are NOT called migration parity. Raw hashes remain unedited in evidence. Packet count87→87, task count64→64; events815→902 (87backfill audit entries). The unchanged migration comparator is still used for the pre-upgrade clone and original protected copies. After-upgrade review is separately labelled `UPGRADE_DELTA_REVIEW_ONLY_NOT_MIGRATION_FIDELITY`; it does not hide new columns, event rows, function permissions or66catalogue changes as the3old extension exceptions. The capability inventory is read-only/presence-only, so its `migrationApplied:false` means that inventory query applies nothing; the separate native apply step records the actual single migration.

Private per-step journals are exclusive/sealed and previous manifests verified before each later step. Full SQL output remains only in the owner-protected VM `.env.p4-runs` rehearsal journal (mode400 after sealing), not this public report. No new credentials, Auth/SMTP/provider/browser requests, worker restart, service/container/edge activation, IAM/network/DNS/Vercel/cloud-Supabase/Google/production change or OCI resource creation. Temporary database allocation used only the existing VM/Postgres and was removed; no paid resource or new volume.

Offline626fresh-home helper tests PASS49.04s/no.ir35/no real keys/no private state/noVMcalls; [manifest](p8-upgrade-hermetic-01/manifest.json) `c455601eff2f6f02db8e53c886be69de4e6c215957dc88705b1ccebb817b49b5`. One initial public-module `inspect.getsource` loader error is [retained](oracle-p8-upgrade-offline-initial-20261027.json); fixed by compiling identical source under its actual filename. No assertions, timeouts, historical hashes or catalogues edited.

## What this does NOT prove

No writable frontend/session/save/normal-app mock-apply flow was run. The current original P5 fixture still has the exact cloud-derived old schema; no retained upgraded app was activated. A separately owned writable app fixture, a verified image including the source OAuth/queue fixes and actual mock-only frontend→queue→worker→callback integration remain necessary. In particular, the normal mock kick is currently disabled; isolated P6 mock-lifecycle PASS must not be substituted for the real app flow or bypassed by enabling a real runner/acceptance.

P8 remains incomplete: actual encrypted backup/fullrestore, exact managed-Cloud Storage reverse path, monitoring/disk alerts and timed drills are still required. The existing public-age/offline-custody and conditional one-VM/one-bucket IAM owner batch is unchanged. P9 is preparation/NO-GO, allPRs draft/unmerged, exact YES CUTOVER absent.
