# P4 first rehearsal — DB/bytes PASS, Storage runtime compatibility FAIL

21 October 2026. Staging only. P4 is **not complete**; no P5, second rehearsal, wipe, reverse-sync, login, production change or cutover follows this failed check.

| Gate | Actual result |
| --- | --- |
| Source read-only preparation | verify-full TLS, exported repeatable-read snapshot, whole native custom archive plus Storage GETs; no source SQL writes |
| First new isolated full DB restore | PASS once, ir35_rehearsal_a_20261021; owners/ACL/defaults preserved, native atomic restore, full private log |
| Every table count/ordered MD5 | PASS62/62, including all27Auth tables and password-hash bytes inside whole-row fingerprints; no values printed |
| Sequences | PASS2/2 last_value/is_called; source stability checked around capture/dump |
| Schema/security |3752catalog objects/0unexplained differences, only3approved owner fields;327supplemental objects/0diff,62extensionACLs/198DDL/552app-role privilege checks/16expiry hashes match |
| Capture+restore+DB verification time |117.398seconds; under30min for this part only, not a timed complete rehearsal |
| Storage file bytes | PASS73/73,1,241,375bytes; all SHA256/lengths equal captured API bytes, exact original versions/locators, full file-set coverage, directories700/files600 ownerir35 |
| Private Storage API startup | **FAIL** READ_ONLY_FROZEN_API_HEALTH; one actual API start, stopped/exited1, no public ports/outbound network/restart loop |
| Image migration compatibility | **FAIL2** historical hash mismatches: storage-schema/id2 and object-versioning-core/id62;74applied rows,75image migrations, source freeze at73 exists in image |
| Post-failure verification | PASS: all62tables/two sequences/schema/security unchanged; original9protected services/eight healthy backends still on original disposable DB, trustedTLS401/Basic/noindex/mock/sink/acceptance=false/Studiooff |

Evidence: [first DB cycle](oracle-p4-cycle1.json), [post-startup data/schema audit](oracle-p4-post-api-audit.json), [two exact migration hashes](oracle-p4-storage-migrations.json), [file SHA256 and runtime protection](oracle-p4-protection.json). Earlier source-only captures are separate snapshots and are not substituted for the archive-bound verification.

## Blocker and safe next repair

The pinned native ARM Storage v1.81.0 image disagrees with the **unchanged copied** storage.migrations records for the two named historical migrations. Its documented migration validator rejects mismatches when DB_ALLOW_MIGRATION_REFRESH=false. This is an image/history compatibility failure, **not evidence that source-to-target rows were lost**: the independent post-failure comparison still matches every row fingerprint. Actual startup signal was failed health/exit1; no raw startup traceback was captured (Docker logs disabled). The read-only image-loader comparison independently proves a blocking incompatibility; no guessed SQLSTATE is claimed.

Do not turn on migration-hash refresh, rewrite the copied history, waive additional differences, grant migration writes or alter cloud to make startup pass. Next proposed repair is to find/build and pin a reviewed ARM64 Storage image whose historical migration fingerprints match the source exactly, test it on another schema/metadata-only fixture first, then resume this same guarded byte proof without replaying the restore. Any schema upgrades remain separate-copy work with before/after diffs, never edits to the verified clone or cloud. A compatibility exception is not self-approved.

The exact untouched clone, protected source archive/bundle/log and byte files remain quarantined. No wipe on failure. The one owned API container remains stopped, restart=no, private-network-only; it is not the original Storage service. No second API attempt, role escalation or IAM change. The original cloud/Vercel/DNS/provider/worker flags are untouched, no real applications or mail. Future rehearsal/API entrypoints now fail locally before source credential lookup/SSH while this compatibility report is FAIL.

## Tooling repairs and verification scope

Local-only fixes: BigInt constructor for the repo's TS target; a test now forbids actual data TRUNCATE commands rather than a legitimate ACL keyword; one-pass template substitution preserves token-like customer filenames; a Storage helper indentation error was fixed before any remote action; image metadata-loader JS syntax was repaired/tested once, network-none/no DB connection, then produced the real2-hash finding. Durable restore count1/API count1 are retained, not reset. No assertion/timeouts/data checks relaxed.

Final current-source946Vitest/149files+199legacy checks,202Linux helpers, strict types/full lint and926-file source/history/dependency scan PASS. A cold WASM initialization exceeded the existing5s test bound once; initialization now awaits readiness in beforeAll, no assertion/default timeout/single-worker change; full suite rerun PASS108.57s. Initial preparation headbae322d has all10hosted checks SUCCESS; final follow-up head CI is separate/pending. No full zero-loss/P4/P5 signoff, Google/password login, load, backup restore or production result is inferred from tests or copied-file checks.

Source references: [pinned startup/migration-freeze flow](https://github.com/supabase/storage/blob/v1.81.0/src/start/server.ts), [hash validation and optional refresh](https://github.com/supabase/storage/blob/v1.81.0/src/internal/database/migrations/migrate.ts), [pinned file backend](https://github.com/supabase/storage/blob/v1.81.0/src/storage/backend/file.ts), [versioned tenant locator](https://github.com/supabase/storage/blob/v1.81.0/src/storage/locator.ts). No public third-party code or secret-bearing runtime output was copied into this report.
