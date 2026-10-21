-- Read-only supplemental coverage: extension members, type ACLs and DDL power.
WITH selected AS (
 SELECT e.*,n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
 WHERE e.extname IN ('pg_stat_statements','pgcrypto','uuid-ossp')
), spaces AS (
 SELECT DISTINCT n.oid,n.nspname,n.nspowner,n.nspacl FROM pg_namespace n JOIN selected e ON n.oid=e.extnamespace
), roles AS (
 SELECT rolname,oid,rolsuper FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
), objects AS (
 SELECT 'schema'::text kind,n.nspname::text name,n.nspowner owner,n.nspacl acl,'n'::"char" aclkind FROM spaces n
 UNION ALL SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',p.proowner,p.proacl,'f'
 FROM pg_proc p JOIN spaces n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')
 UNION ALL SELECT 'relation',n.nspname||'.'||c.relname,c.relowner,c.relacl,CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END
 FROM pg_class c JOIN spaces n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f','S')
 UNION ALL SELECT 'type',n.nspname||'.'||t.typname,t.typowner,t.typacl,'T'
 FROM pg_type t JOIN spaces n ON n.oid=t.typnamespace
), acl AS (
 SELECT o.kind,o.name,pg_get_userbyid(o.owner) owner,
 coalesce((SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(x.grantor),
  'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
  'privilege',x.privilege_type,'grantable',x.is_grantable)
 ORDER BY pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type)
 FROM aclexplode(coalesce(o.acl,acldefault(o.aclkind,o.owner))) x),'[]'::jsonb) grants
 FROM objects o
), capability AS (
 SELECT o.kind,o.name,r.rolname role,jsonb_build_object('superuser',r.rolsuper,
 'ownerInherited',pg_has_role(r.oid,o.owner,'USAGE'),'canSetOwnerRole',pg_has_role(r.oid,o.owner,'SET')) value
 FROM objects o CROSS JOIN roles r
 UNION ALL SELECT 'schema-create',n.nspname,r.rolname,jsonb_build_object('create',has_schema_privilege(r.oid,n.oid,'CREATE'),
 'usage',has_schema_privilege(r.oid,n.oid,'USAGE')) FROM spaces n CROSS JOIN roles r
 UNION ALL SELECT 'extension',e.extname,r.rolname,jsonb_build_object('superuser',r.rolsuper,
 'ownerInherited',pg_has_role(r.oid,e.extowner,'USAGE'),'canSetOwnerRole',pg_has_role(r.oid,e.extowner,'SET')) FROM selected e CROSS JOIN roles r
)
SELECT jsonb_build_object('version',1,
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',extname,'version',extversion,'schema',nspname,'owner',pg_get_userbyid(extowner)) ORDER BY extname) FROM selected),
 'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('extension',e.extname,'class',d.classid::regclass::text,
   'identity',i.identity) ORDER BY e.extname,d.classid::regclass::text,i.identity),'[]'::jsonb)
 FROM pg_depend d JOIN selected e ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid
 CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) i WHERE d.deptype='e'),
 'objects',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'name',name,'hash',md5(jsonb_build_object('owner',owner,'grants',grants)::text)) ORDER BY kind,name) FROM acl),
 'capabilities',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'name',name,'role',role,'value',value) ORDER BY kind,name,role) FROM capability));
