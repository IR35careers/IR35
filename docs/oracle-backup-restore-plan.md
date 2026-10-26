# P8 backup/restore plan — NOT INSTALLED or signed off

No backup upload, IAM change, lifecycle policy, timer, private-key creation, or restore is authorised by this file. The current browser SecurityToken refresh failed once: batch G2 instead of retrying it. Read-only inventory must establish existing access before proposing any new permission. Never copy a laptop API signing key or private age identity to the VM, create a public PAR, or use an unreviewed credential as a workaround.

## Exact budget before any upload/create

- One London A1,2OCPU/12GB;50GB boot+100GB block=150GB live volumes. This is historical allocation, NOT a current authenticated usage/cost read-back.
- Combined boot/block backups<=5; never infer backup allowance from unused live-volume GB. A budget alert is not a spending cap.
- All Object Storage objects, versions and unfinished multipart part sizes must be counted exactly by the existing paged read-only counter. Fail on unclear counts or>80% of20GB. Owner's stricter8,000,000,000-byte cap includes in-flight upload overlap. Private Standard tier only, no versioning/auto-tiering. API requests also need a monthly free-allowance budget.
- Keep7 daily +4 weekly complete generations, selecting one snapshot for overlapping periods rather than uploading duplicate archives. `backup_retention.py` is an OFFLINE planner only. It refuses a partial/unverified generation, an unknown byte total, wrong tier, plaintext part, and any upload that needs deletion of an old restore point to fit. Actual pruning is not implemented/enabled and must revalidate object identity/checksum before a whole-generation delete.

Oracle's [Always Free documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) distinguishes trial Standard limits from post-trial combined limits. The8GB owner cap is conservative; a free-trial credit balance is never authority for paid storage. Re-read live subscription/usage before implementation. [Oracle Object Storage security guidance](https://docs.oracle.com/en-us/iaas/Content/Security/Reference/objectstorage_security.htm) calls for least privilege and tightly controlled deletion. No IAM change is currently authorised; if instance-principal access is absent, report a proposed one-VM/one-bucket scope for owner review, not broad object-family access.

## Backup payload and custody

Stream `pg_dump17` custom archives for the final application DB AND operational queue DB plus encrypted globals/roles/grants. Include every source/app/Auth/Storage/Realtime schema and sequence; do not silently omit queue receipts. Stream the matching physical Storage backend including required metadata/xattrs. Include versioned config/source/image digests and redacted verification manifests. Never include Caddy ACME state, Docker cache, `.env*`, private signing/SSH/age keys or unencrypted credentials. Secrets recover from the owner's password manager, not public evidence.

Compress then age-encrypt each stream using ONLY the owner's public recipient on the VM. Use `set -euo pipefail`, exclusive generation paths, no plaintext intermediate dump/tar/role log, owner-only ciphertext files, and no secret command arguments. A partial pipeline must leave an explicitly FAILED/uncommitted generation, never a success manifest. A successful upload needs a complete-set commit marker AFTER ciphertext SHA256 read-back and exact byte-budget reconciliation. The verification part must also be age-encrypted if it contains physical object locators or any private data.

## Mandatory restore drill before PASS

1. Verify encrypted remote artifacts and journal hashes; owner supplies the private age identity only through an approved offline/hidden mechanism, never chat/argv/VM.
2. Restore to a uniquely owned, isolated scratch DB and scratch Storage backend. No API to real providers/mailboxes, no public DB/Studio ports, no production target, no overwrite of P4/P5/pristine data.
3. Recreate exact roles/owners/ACLs before restore with ON_ERROR_STOP; never `--no-owner`/`--no-acl`, drop data, change hashes, or edit catalogues. Fresh staging secrets stay distinct from cloud.
4. Full62 counts/orderedMD5/Auth hashes,2 sequences, schema parity apart from the3 exact approved ownership exceptions,552 original privileges+queue-role/HBA boundary, all73 Storage bytes/xattrs and bucket restrictions. Restore queue state separately without re-dispatching any job. Any mismatch aborts.
5. Destroy ONLY the owned scratch resources after evidence is sealed; verify unchanged pristine/P5 data and source manifests again. Record full timing, hashes, cleanup and hard-stop counters. A decrypt/list-only check is NOT a restore test.

Nightly timer, upload, pruning, weekly volume backup, fresh free/cost reconciliation, restore and alert delivery remain unexecuted. Do not label P8 PASS or release a production cutover until all are actually proven.
