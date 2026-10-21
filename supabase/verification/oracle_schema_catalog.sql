-- Catalog-only, no row/password/function-body values exported.
-- Caller supplies a repeatable-read READ ONLY transaction and pg_catalog path.
WITH namespaces AS (
 SELECT oid,nspname,nspowner,nspacl FROM pg_namespace
 WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'
), relations AS (
 SELECT c.*,n.nspname FROM pg_class c JOIN namespaces n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m','S','f')
), objects AS (
 SELECT 'schema'::text kind,nspname::text name,jsonb_build_object('owner',pg_get_userbyid(nspowner)) value FROM namespaces
 UNION ALL
 SELECT 'table',nspname||'.'||relname,jsonb_build_object('kind',relkind,'persistence',relpersistence,
  'owner',pg_get_userbyid(relowner),'replicaIdentity',relreplident,'partition',pg_get_expr(relpartbound,oid))
 FROM relations WHERE relkind IN ('r','p','f')
 UNION ALL
 SELECT 'column',c.nspname||'.'||c.relname||'.'||a.attname,
  jsonb_build_object('position',row_number() OVER(PARTITION BY c.oid ORDER BY a.attnum),'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
   'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
   'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END)
 FROM pg_attribute a JOIN relations c ON c.oid=a.attrelid
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f')
 UNION ALL
 SELECT 'constraint',c.nspname||'.'||c.relname||'.'||k.conname,
  jsonb_build_object('definition',pg_get_constraintdef(k.oid),'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred)
 FROM pg_constraint k JOIN relations c ON c.oid=k.conrelid
 UNION ALL
 SELECT 'index',n.nspname||'.'||c.relname,jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),
  'valid',i.indisvalid,'ready',i.indisready,'clustered',i.indisclustered,'replicaIdentity',i.indisreplident)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN namespaces n ON n.oid=c.relnamespace
 UNION ALL
 SELECT 'rls',nspname||'.'||relname,jsonb_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity)
 FROM relations WHERE relkind IN ('r','p')
 UNION ALL
 SELECT 'policy',schemaname||'.'||tablename||'.'||policyname,
  jsonb_build_object('permissive',permissive,'roles',(SELECT jsonb_agg(r ORDER BY r) FROM unnest(roles) r),'command',cmd,'using',qual,'check',with_check)
 FROM pg_policies WHERE schemaname IN (SELECT nspname FROM namespaces)
 UNION ALL
 SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
  jsonb_build_object('definitionHash',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'config',p.proconfig)
 FROM pg_proc p JOIN namespaces n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')
 UNION ALL
 SELECT 'trigger',c.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
 FROM pg_trigger t JOIN relations c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal
 UNION ALL
 SELECT 'sequence',c.nspname||'.'||c.relname,jsonb_build_object('type',s.seqtypid::regtype::text,'start',s.seqstart::text,
  'increment',s.seqincrement::text,'min',s.seqmin::text,'max',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle,
  'owner',pg_get_userbyid(c.relowner),'ownedBy',(SELECT jsonb_build_object('table',d.refobjid::regclass::text,'column',a.attname,'dependency',d.deptype)
    FROM pg_depend d JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
    WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i') LIMIT 1))
 FROM pg_sequence s JOIN relations c ON c.oid=s.seqrelid
 UNION ALL
 SELECT 'view',nspname||'.'||relname,jsonb_build_object('definitionHash',md5(pg_get_viewdef(oid)),
  'owner',pg_get_userbyid(relowner),'options',reloptions,'kind',relkind) FROM relations WHERE relkind IN ('v','m')
 UNION ALL
 SELECT 'type',n.nspname||'.'||t.typname,jsonb_build_object('kind',t.typtype,'owner',pg_get_userbyid(t.typowner),
  'base',CASE WHEN t.typbasetype=0 THEN NULL ELSE format_type(t.typbasetype,t.typtypmod) END,
  'default',t.typdefault,'notNull',t.typnotnull,'labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid))
 FROM pg_type t JOIN namespaces n ON n.oid=t.typnamespace
 WHERE t.typtype IN ('e','d','r','m')
 UNION ALL
 SELECT 'extension',e.extname,jsonb_build_object('version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner))
 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 UNION ALL
 SELECT 'grant',object_name||':'||names.grantor||':'||names.grantee||':'||a.privilege_type,
  jsonb_build_object('grantor',names.grantor,'grantee',names.grantee,'privilege',a.privilege_type,'grantable',a.is_grantable)
 FROM (
  SELECT 'schema:'||n.nspname object_name,x.* FROM namespaces n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) x
  UNION ALL SELECT 'relation:'||c.nspname||'.'||c.relname,x.* FROM relations c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x
  UNION ALL SELECT 'function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',x.* FROM pg_proc p JOIN namespaces n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x WHERE p.prokind IN ('f','p')
  UNION ALL SELECT 'column:'||c.nspname||'.'||c.relname||'.'||a.attname,x.* FROM pg_attribute a JOIN relations c ON c.oid=a.attrelid CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attnum>0 AND NOT a.attisdropped
  UNION ALL SELECT 'default:'||pg_get_userbyid(d.defaclrole)||':'||coalesce(n.nspname,'*')||':'||d.defaclobjtype::text,x.* FROM pg_default_acl d LEFT JOIN namespaces n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) x WHERE d.defaclnamespace=0 OR n.oid IS NOT NULL
 ) a CROSS JOIN LATERAL (SELECT pg_get_userbyid(a.grantor) grantor,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee) names
 UNION ALL
 SELECT 'role',rolname,jsonb_build_object('superuser',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDB',rolcreatedb,'login',rolcanlogin,
  'replication',rolreplication,'bypassRLS',rolbypassrls,'connectionLimit',rolconnlimit,'config',rolconfig)
 FROM pg_roles WHERE rolname !~ '^pg_'
 UNION ALL
 SELECT 'role-membership',r.rolname||':'||m.rolname||':'||g.rolname,jsonb_build_object('admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option)
 FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor
 WHERE r.rolname !~ '^pg_' OR m.rolname !~ '^pg_'
)
SELECT jsonb_build_object('version',1,'checkedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'serverVersion',current_setting('server_version'),'encoding',current_setting('server_encoding'),
 'collation',(SELECT jsonb_build_object('collate',datcollate,'ctype',datctype,'provider',datlocprovider,'locale',datlocale) FROM pg_database WHERE datname=current_database()),
 'schemas',(SELECT jsonb_agg(nspname ORDER BY nspname) FROM namespaces),
 'objects',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'name',name,'value',value,'hash',md5(value::text)) ORDER BY kind,name) FROM objects)) AS catalog;
