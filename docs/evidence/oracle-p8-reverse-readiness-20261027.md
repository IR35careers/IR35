# Reverse migration readiness — staging capability PASS, Cloud restore UNPROVEN

No reverse transfer, database/role/setting/Storage mutation, package install, customer write or Cloud request occurred. [Read-only result](p8/reverse-preflight-01/01-capabilities-containment-result.json), [manifest](p8/reverse-preflight-01/manifest.json) SHA256 `4072cef6975372073066f7338b91ae3063d7d45c275a7ae857194add9f634edf`.

The existing **staging** `supabase_admin` is a superuser and can create DBs/set the replication parameter; current session remains `origin`. PG17 catalog has53 foreign keys, ALL non-deferrable,9 generated columns and1 identity column; no partitions. A naïve all-column COPY/upsert or FK-order assumption is unsafe. These are existing platform capabilities, NOT new grants and NOT proof that a usable Cloud restore login has equivalent rights. No `SET`/DDL/role change was attempted.

Full post-inventory containment PASS:62table counts/orderedMD5/Auth,2sequences,3approved exceptions,552original privileges+queue-role additions,73Storage hashes and112fresh HBA denials. Original source/pristine/P5 snapshots remain unchanged. Reverse data transfer remains unimplemented, not labelled PASS from capability metadata.

## Storage metadata parity is a release blocker, not a checksum waiver

Reviewed upstream compatible release `v1.80.2` at commit `db42280506a07a165376219b2d6ac7bc92ccdfcc` (GitHub tag resolution). This is source review of the compatible release, NOT an authenticated statement of the managed Cloud service's exact running build or all provider-internal restore capabilities.

| Primary source | Observed behaviour |
| --- | --- |
| [Uploader](https://github.com/supabase/storage/blob/db42280506a07a165376219b2d6ac7bc92ccdfcc/src/storage/uploader.ts) | Standard uploads allocate a fresh version, then use that version for backend write and database completion. |
| [TUS lifecycle](https://github.com/supabase/storage/blob/db42280506a07a165376219b2d6ac7bc92ccdfcc/src/http/routes/tus/lifecycle.ts) | Resumable upload naming also allocates a fresh version; finish uses that version. No client-selected preservation option in this reviewed path. |
| [S3 handler](https://github.com/supabase/storage/blob/db42280506a07a165376219b2d6ac7bc92ccdfcc/src/storage/protocols/s3/s3-handler.ts) | Ordinary PutObject uses the uploader; multipart creation uses its version allocator. Gateway credentials alone are not proven raw-backend restore access. |
| [S3 backend](https://github.com/supabase/storage/blob/db42280506a07a165376219b2d6ac7bc92ccdfcc/src/storage/backend/s3/adapter.ts) | Backend object keys for reads/writes depend on object version. Merely restoring an old SQL version after an API upload can refer to another physical key. |

Therefore, a normal API re-upload can preserve file SHA256 while changing `storage.objects` metadata. Full row MD5 must still FAIL in that case. Copying metadata back over regenerated backend versions is not a certified remedy. New unit regression proves identical Storage byte manifests do NOT waive changed SQL metadata. No Golden hash, comparator, assertion or catalog was altered. No live upload was used to manufacture a mismatch.

A local file-backend mirror or a DB-only reverse test is NOT enough to claim Oracle→managed-Cloud losslessness. Before releasing, establish a provider-supported, zero-cost way to preserve/restore backend versions and every database metadata field, and separately verify the actual Cloud restore role's capabilities. No documented supported preserving path has been established in this audit; this is **not** a claim that every possible provider-assisted method is impossible.

Do not search for backend secrets, patch managed storage, exploit upload IDs, bypass access checks, buy a backup/PITR add-on, normalise metadata hashes or keep production secretly dependent on Cloud Storage. Do not unilaterally freeze Oracle Storage writes for48h or change the rollback scope to avoid this gate. Any such scope change requires an explicit owner decision, not an agent workaround. Keep cutover NO-GO until the original full verification requirement is satisfied or the owner explicitly revises it.

Suggested owner/provider question (draft only, NOT sent): “Is there a free supported import/restore path from self-hosted file-backend Supabase to our existing managed project that preserves all storage.objects rows (including versions/IDs/timestamps/metadata) AND every object byte? What operator privileges are required? Ordinary uploads in compatible1.80.2 allocate new versions. We cannot change the verification standard, expose backend keys or purchase an add-on.”

The existing owner batch (fresh Oracle sign-in, age-public-recipient/offline-key mechanism, proposed narrow bucket access) is still pending. G3 is closed. No second browser/refresh/SSH prompt, real email, production/provider/DNS/IAM/secret change or cutover.
