-- Catalog/configuration metadata only; no passwords, rows or function bodies.
SELECT jsonb_build_object(
 'extensionSupport',(SELECT jsonb_agg(jsonb_build_object('name',name,'version',version,'superuser',superuser,'trusted',trusted))
 FROM pg_available_extension_versions WHERE (name,version) IN (('pg_stat_statements','1.11'),('pgcrypto','1.3'),('uuid-ossp','1.1'))),
 'supautils',(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN
 ('supautils.superuser','supautils.privileged_role','supautils.privileged_extensions','supautils.privileged_extensions_custom_scripts_path','shared_preload_libraries')),
 'graphqlSchemas',(SELECT jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),
 'currentACLHash',md5(n.nspacl::text),'initialACLHash',md5(i.initprivs::text),'initialPrivilegeType',i.privtype,
 'extension',(SELECT e.extname FROM pg_depend d JOIN pg_extension e ON d.refclassid='pg_extension'::regclass AND e.oid=d.refobjid
 WHERE d.classid='pg_namespace'::regclass AND d.objid=n.oid AND d.deptype='e')) ORDER BY n.nspname)
 FROM pg_namespace n LEFT JOIN pg_init_privs i ON i.objoid=n.oid AND i.classoid='pg_namespace'::regclass AND i.objsubid=0
 WHERE n.nspname IN ('graphql','graphql_public')));
