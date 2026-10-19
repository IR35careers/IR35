-- P0 metadata and aggregate counts only. No rows, object names, credentials,
-- password hashes, function bodies, policy expressions or cron commands leave DB.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

WITH schemas AS (
  SELECT oid, nspname FROM pg_namespace
  WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'
), tables AS (
  SELECT n.nspname AS schema, c.relname AS name, c.oid,
    c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
    c.relispartition AS is_partition, pg_total_relation_size(c.oid) AS bytes,
    ((xpath('/row/c/text()', query_to_xml(
      format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
      false, true, '')))[1]::text)::bigint AS rows
  FROM pg_class c JOIN schemas n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
), policies AS (
  SELECT schemaname AS schema, tablename AS table_name, policyname AS name,
    permissive, roles::text AS roles, cmd,
    md5(coalesce(qual, '')) AS using_hash,
    md5(coalesce(with_check, '')) AS check_hash
  FROM pg_policies WHERE schemaname IN (SELECT nspname FROM schemas)
), functions AS (
  SELECT n.nspname AS schema, p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS identity_arguments,
    p.prosecdef AS security_definer,
    md5(pg_get_functiondef(p.oid)) AS definition_hash,
    EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
      AND d.objid = p.oid AND d.deptype = 'e') AS extension_owned
  FROM pg_proc p JOIN schemas n ON n.oid = p.pronamespace
  WHERE p.prokind IN ('f', 'p')
), triggers AS (
  SELECT n.nspname AS schema, c.relname AS table_name, t.tgname AS name,
    t.tgenabled::text AS enabled, p.proname AS function_name,
    md5(pg_get_triggerdef(t.oid)) AS definition_hash
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN schemas n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
), buckets AS (
  SELECT b.id, b.public, count(o.id)::bigint AS objects,
    coalesce(sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]+$'
      THEN (o.metadata->>'size')::numeric ELSE 0 END), 0)::bigint AS object_bytes,
    count(o.id) FILTER (WHERE o.metadata->>'size' IS NULL
      OR o.metadata->>'size' !~ '^[0-9]+$')::bigint AS missing_size_metadata
  FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id
  GROUP BY b.id, b.public
)
SELECT jsonb_build_object(
  'catalogVersion', 1,
  'checkedAt', to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'serverVersion', current_setting('server_version'),
  'databaseBytes', pg_database_size(current_database()),
  'schemas', (SELECT coalesce(jsonb_agg(nspname ORDER BY nspname), '[]') FROM schemas),
  'extensions', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', e.extname,
    'version', e.extversion, 'schema', n.nspname) ORDER BY e.extname), '[]')
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace),
  'tables', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'oid' ORDER BY schema, name), '[]') FROM tables t),
  'policies', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY schema, table_name, name), '[]') FROM policies p),
  'functions', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY schema, name, identity_arguments), '[]') FROM functions f),
  'triggers', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY schema, table_name, name), '[]') FROM triggers t),
  'buckets', (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id), '[]') FROM buckets b),
  'identityProvidersInUse', (SELECT coalesce(jsonb_agg(jsonb_build_object('provider', provider,
    'identities', identities) ORDER BY provider), '[]')
    FROM (SELECT provider, count(*)::bigint AS identities FROM auth.identities GROUP BY provider) p),
  'publications', (SELECT coalesce(jsonb_agg(jsonb_build_object('publication', pubname,
    'schema', schemaname, 'table', tablename) ORDER BY pubname, schemaname, tablename), '[]')
    FROM pg_publication_tables),
  'migrationVersions', (SELECT coalesce(jsonb_agg(version ORDER BY version), '[]') FROM supabase_migrations.schema_migrations)
) AS inventory;
ROLLBACK;
