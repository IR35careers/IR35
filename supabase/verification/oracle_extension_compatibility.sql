-- Run read-only inside the pinned ARM staging image BEFORE P3/restore.
-- A false source_version_available or installed_version_matches blocks P3.
-- This lists blockers; it never installs, upgrades or downgrades extensions.
BEGIN TRANSACTION READ ONLY;
WITH required(name, version) AS (VALUES
  ('pg_stat_statements', '1.11'), ('pgcrypto', '1.3'), ('plpgsql', '1.0'),
  ('supabase_vault', '0.3.1'), ('uuid-ossp', '1.1')
)
SELECT required.name, required.version AS source_version,
  EXISTS (SELECT 1 FROM pg_available_extension_versions available
    WHERE available.name = required.name AND available.version = required.version) AS source_version_available,
  installed.extversion AS installed_version,
  (installed.extversion IS NULL OR installed.extversion = required.version) AS installed_version_matches
FROM required LEFT JOIN pg_extension installed ON installed.extname = required.name
ORDER BY required.name;
ROLLBACK;
