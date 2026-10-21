-- Supplemental schema transport surface before any P4 customer-data copy.
-- Definitions/options are hashed inside PG; never export their values.
WITH spaces AS (
 SELECT oid,nspname FROM pg_namespace WHERE nspname<>'information_schema' AND nspname!~'^pg_'
), objects AS (
 SELECT 'publication'::text kind,p.pubname::text name,
  jsonb_build_object('owner',pg_get_userbyid(p.pubowner),'allTables',p.puballtables,
   'insert',p.pubinsert,'update',p.pubupdate,'delete',p.pubdelete,'truncate',p.pubtruncate,
   'viaRoot',p.pubviaroot) value FROM pg_publication p
 UNION ALL
 SELECT 'publication-table',pubname||':'||schemaname||'.'||tablename,
  jsonb_build_object('columns',attnames,'filter',rowfilter)
 FROM pg_publication_tables WHERE schemaname IN (SELECT nspname FROM spaces)
 UNION ALL
 SELECT 'event-trigger',e.evtname,jsonb_build_object('owner',pg_get_userbyid(e.evtowner),
  'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,'function',e.evtfoid::regprocedure::text)
 FROM pg_event_trigger e
 UNION ALL
 SELECT 'type-acl',n.nspname||'.'||t.typname||':'||pg_get_userbyid(a.grantor)||':'||
  CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||a.privilege_type,
  jsonb_build_object('owner',pg_get_userbyid(t.typowner),'grantable',a.is_grantable)
 FROM pg_type t JOIN spaces n ON n.oid=t.typnamespace
 CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a
 UNION ALL
 SELECT 'foreign-wrapper',w.fdwname,jsonb_build_object('owner',pg_get_userbyid(w.fdwowner),
  'handler',w.fdwhandler::regproc::text,'validator',w.fdwvalidator::regproc::text,'options',w.fdwoptions,'acl',w.fdwacl)
 FROM pg_foreign_data_wrapper w
 UNION ALL
 SELECT 'foreign-server',s.srvname,jsonb_build_object('owner',pg_get_userbyid(s.srvowner),
  'wrapper',w.fdwname,'type',s.srvtype,'version',s.srvversion,'options',s.srvoptions,'acl',s.srvacl)
 FROM pg_foreign_server s JOIN pg_foreign_data_wrapper w ON w.oid=s.srvfdw
 UNION ALL
 SELECT 'foreign-mapping',s.srvname||':'||CASE WHEN u.umuser=0 THEN 'PUBLIC' ELSE pg_get_userbyid(u.umuser) END,
  jsonb_build_object('options',u.umoptions) FROM pg_user_mapping u JOIN pg_foreign_server s ON s.oid=u.umserver
 UNION ALL
 SELECT 'extended-statistics',n.nspname||'.'||s.stxname,
  jsonb_build_object('owner',pg_get_userbyid(s.stxowner),'definition',pg_get_statisticsobjdef(s.oid))
 FROM pg_statistic_ext s JOIN spaces n ON n.oid=s.stxnamespace
 UNION ALL
 SELECT 'collation',n.nspname||'.'||c.collname,
  jsonb_build_object('owner',pg_get_userbyid(c.collowner),'provider',c.collprovider,'deterministic',c.collisdeterministic,
   'encoding',c.collencoding,'collate',c.collcollate,'ctype',c.collctype,'locale',c.colllocale,'rules',c.collicurules,'version',c.collversion)
 FROM pg_collation c JOIN spaces n ON n.oid=c.collnamespace
)
SELECT jsonb_build_object('version',1,'checkedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'objects',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',kind,'name',name,'hash',md5(value::text)) ORDER BY kind,name) FROM objects),'[]'::jsonb)) AS transport;
