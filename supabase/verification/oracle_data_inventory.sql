-- Table inventory only: customer columns/paths/passwords are never selected.
WITH spaces AS (
 SELECT oid,nspname FROM pg_namespace WHERE nspname<>'information_schema' AND nspname!~'^pg_'
), tables AS (
 SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN spaces n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p')
)
SELECT jsonb_build_object('version',1,'tables',coalesce((SELECT jsonb_agg(jsonb_build_object('schema',t.nspname,'name',t.relname,
 'columns',(SELECT jsonb_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped),
 'primaryKey',coalesce((SELECT jsonb_agg(a.attname ORDER BY k.position) FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(number,position)
 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.number WHERE i.indrelid=t.oid AND i.indisprimary AND k.position<=i.indnkeyatts),'[]'::jsonb)) ORDER BY t.nspname,t.relname) FROM tables t),'[]'::jsonb),
 'sequences',coalesce((SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) ORDER BY n.nspname,c.relname)
 FROM pg_class c JOIN spaces n ON n.oid=c.relnamespace WHERE c.relkind='S'),'[]'::jsonb),
 'largeObjectCount',(SELECT count(*)::text FROM pg_largeobject_metadata)) AS inventory;
