-- Metadata-only. Run in REPEATABLE READ READ ONLY, search_path=pg_catalog.
-- Missing roles fail instead of silently returning an empty comparison.
WITH roles AS (
 SELECT role_name, role_name::regrole::oid role_id
 FROM unnest(ARRAY['anon','authenticated','service_role']) role_name
), namespaces AS (
 SELECT oid,nspname FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'
), relations AS (
 SELECT c.*,n.nspname FROM pg_class c JOIN namespaces n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m','f','S')
), entries AS (
 SELECT 'schema'::text kind,n.nspname::text name,r.role_name role,
 jsonb_build_object('USAGE',has_schema_privilege(r.role_id,n.oid,'USAGE'),
  'USAGE WITH GRANT OPTION',has_schema_privilege(r.role_id,n.oid,'USAGE WITH GRANT OPTION'),
  'CREATE',has_schema_privilege(r.role_id,n.oid,'CREATE'),
  'CREATE WITH GRANT OPTION',has_schema_privilege(r.role_id,n.oid,'CREATE WITH GRANT OPTION')) privileges
 FROM namespaces n CROSS JOIN roles r
 UNION ALL
 SELECT CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END,c.nspname||'.'||c.relname,r.role_name,
 (SELECT jsonb_object_agg(p,has_table_privilege(r.role_id,c.oid,p) ORDER BY p)
  FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN',
  'SELECT WITH GRANT OPTION','INSERT WITH GRANT OPTION','UPDATE WITH GRANT OPTION','DELETE WITH GRANT OPTION',
  'TRUNCATE WITH GRANT OPTION','REFERENCES WITH GRANT OPTION','TRIGGER WITH GRANT OPTION','MAINTAIN WITH GRANT OPTION']) p)
 FROM relations c CROSS JOIN roles r WHERE c.relkind <> 'S'
 UNION ALL
 SELECT 'sequence',c.nspname||'.'||c.relname,r.role_name,
 (SELECT jsonb_object_agg(p,has_sequence_privilege(r.role_id,c.oid,p) ORDER BY p)
  FROM unnest(ARRAY['USAGE','SELECT','UPDATE','USAGE WITH GRANT OPTION','SELECT WITH GRANT OPTION','UPDATE WITH GRANT OPTION']) p)
 FROM relations c CROSS JOIN roles r WHERE c.relkind='S'
 UNION ALL
 SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',r.role_name,
 jsonb_build_object('EXECUTE',has_function_privilege(r.role_id,p.oid,'EXECUTE'),
  'EXECUTE WITH GRANT OPTION',has_function_privilege(r.role_id,p.oid,'EXECUTE WITH GRANT OPTION'))
 FROM pg_proc p JOIN namespaces n ON n.oid=p.pronamespace CROSS JOIN roles r WHERE p.prokind IN ('f','p')
)
SELECT jsonb_build_object('version',1,'checkedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'roles',ARRAY['anon','authenticated','service_role'],
 'entries',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'name',name,'role',role,'privileges',privileges) ORDER BY kind,name,role) FROM entries)) AS privileges;
