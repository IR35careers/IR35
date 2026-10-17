# Pre-migration backup gate

Owner decision, 17 October 2026: portable passphrase encryption; enter the passphrase twice in a hidden prompt, never in chat or command arguments. No migration until full decryption and archive readability verification pass. The agent runs commands; the owner supplies the two entries and copies the verified artifacts to a second location.

## Current preparation — no backup claimed yet

- PostgreSQL client 17.11 was installed from PostgreSQL's official signed Ubuntu repository in the existing Ubuntu 24.04 WSL environment. No database server or Docker was installed.
- GnuPG symmetric AES256 with salted/iterated SHA256 S2K and integrity protection encrypts the native dump streams. Plaintext SQL, auth records, CV contents and passphrases never pass through a disk file or tool output.
- The Supabase CLI's linked-project temporary connection is captured privately in memory; passwords are never arguments or logs. Session pooler `aws-1-eu-west-2.pooler.supabase.com:5432`, database postgres, project `kxcbgflleqnjzjbkevwd` are validated before export.
- Certificate and hostname verification stay enabled. Supabase Studio's [official certificate configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json) publishes the CA download. The downloaded 2021 CA has DER SHA-256 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`, expires 26 April 2031, and the live TLS/native database preflight verifies successfully with it. No provider security toggle was changed.
- Scripts and public CA are outside the repo at `C:\Users\anves\.codex\operations\ir35careers`. The encrypted backup root is `C:\Users\anves\IR35CareersBackups`; it is not inside Git, so no repository ignore exception is needed. Never move a plaintext dump into the checkout.
- A synthetic encryption/decryption/wrong-passphrase test passed. This is not a production data backup. The separate PowerShell prompt must receive the real passphrase before export begins.

## Required artifacts and proof

1. `database.dump.gpg`: native custom-format `pg_dump`, including schema definitions, table data, owners, ACLs and policies for **auth, public and storage**. No `--no-acl` or `--no-owner` flags.
2. `globals.sql.gpg`: native `pg_dumpall --globals-only --role=postgres`, preserving roles/grants, encrypted identically. Do not silently omit inaccessible role passwords or suppress dump failures.
3. Fully decrypt both streams with integrity validation. Validate the globals SQL header, count roles/grants, and run `pg_restore --list` on the database archive. Count base tables by schema and table-data/ACL entries; require all three requested schemas.
4. After success only, save `manifest.json` containing verification results, table counts, encrypted file sizes and SHA-256 checksums. It contains no passwords or table data. Report the actual directory and both encrypted-file paths; no predicted success or size.
5. Keep all migrations gated until these proofs pass. A readable archive is not a trial restore; label that distinction. Preserve any incomplete encrypted outputs as unverified, with no successful manifest.

Storage schema backup includes **metadata, not the object file bytes** (uploaded CV/PDF files need a separate Storage object backup if the planned operation affects them). Supabase managed roles and installed extensions require provider-aware restoration: never blindly execute globals SQL or overwrite managed schemas on another project. No restore or destructive operation is authorized by taking this backup.

Primary guidance: [Supabase backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [SSL verification](https://supabase.com/docs/guides/platform/ssl-enforcement), [official PostgreSQL Ubuntu packages](https://www.postgresql.org/download/linux/ubuntu/).
