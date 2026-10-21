-- P3 decisive application-schema gate, not the P4 zero-loss data verifier.
-- Definitions are hashed inside Postgres; no bodies, rows or secrets exported.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog;
WITH objects AS (
  SELECT 'column' AS kind, c.relname || '.' || a.attname AS name,
    md5(jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),
      'identity',a.attidentity,'generated',a.attgenerated)::text) AS hash
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
  UNION ALL
  SELECT 'policy', tablename || '.' || policyname,
    md5(jsonb_build_object('permissive',permissive,'roles',roles,'command',cmd,'using',qual,'check',with_check)::text)
  FROM pg_policies WHERE schemaname='public'
  UNION ALL
  SELECT 'trigger', c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'rls', c.relname, md5(jsonb_build_object('enabled',c.relrowsecurity,'forced',c.relforcerowsecurity)::text)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
)
SELECT jsonb_build_object('scope','P3 public schema subset; any difference is FAIL, equality alone is not full verification',
  'checkedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'serverVersion',current_setting('server_version'),
  'objects',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',name,'hash',hash) ORDER BY kind,name),'[]') FROM objects)) AS schema_catalog;
ROLLBACK;
