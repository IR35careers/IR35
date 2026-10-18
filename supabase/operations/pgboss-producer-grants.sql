-- Run as ir35_queue AFTER setup-queue.ts, and only after the verified backup
-- gate. This file creates no login/password and changes only private pg-boss
-- ACLs/defaults. It must not be applied by the application's migration runner.
BEGIN;
DO $$
BEGIN
  IF current_user <> 'ir35_queue' OR NOT EXISTS (
    SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = 'pgboss' AND r.rolname = current_user
  ) THEN
    RAISE EXCEPTION 'Run queue grants as the dedicated pgboss schema owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user
      AND (NOT rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolinherit OR rolbypassrls OR rolreplication)
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
    WHERE r.rolname = current_user
  ) THEN
    RAISE EXCEPTION 'Queue owner must be nonprivileged and have no role memberships';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'ir35_queue_producer'
      AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolinherit AND NOT rolbypassrls AND NOT rolreplication
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
    WHERE r.rolname = 'ir35_queue_producer'
  ) THEN
    RAISE EXCEPTION 'Queue producer must be a nonprivileged login without role memberships';
  END IF;
END;
$$;

REVOKE ALL ON SCHEMA pgboss FROM PUBLIC, anon, authenticated, ir35_queue_producer;
GRANT USAGE ON SCHEMA pgboss TO ir35_queue_producer;
REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM PUBLIC, anon, authenticated, ir35_queue_producer;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA pgboss TO ir35_queue_producer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgboss FROM PUBLIC, anon, authenticated, ir35_queue_producer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO ir35_queue_producer;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC, anon, authenticated, ir35_queue_producer;
-- Ordinary send() calls the schema clock; no schema-maintenance function is
-- needed by Vercel. Do not restore PUBLIC EXECUTE to make a producer test pass.
GRANT EXECUTE ON FUNCTION pgboss.job_now() TO ir35_queue_producer;

ALTER DEFAULT PRIVILEGES FOR ROLE ir35_queue IN SCHEMA pgboss
  GRANT SELECT, INSERT ON TABLES TO ir35_queue_producer;
ALTER DEFAULT PRIVILEGES FOR ROLE ir35_queue IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO ir35_queue_producer;
-- A schema-scoped revoke cannot override PostgreSQL's global PUBLIC function
-- default. This affects future functions of this queue-only owner, not postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE ir35_queue
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Verify the effective ACLs, including column rights and alternate grant paths,
-- rather than assuming every REVOKE affected every existing grantor.
DO $$
BEGIN
  IF has_schema_privilege('ir35_queue_producer', 'pgboss', 'CREATE') OR EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'p') AND (
      has_any_column_privilege('ir35_queue_producer', c.oid, 'UPDATE') OR
      has_table_privilege('ir35_queue_producer', c.oid, 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
    )
  ) THEN
    RAISE EXCEPTION 'Queue producer retains unexpected mutation privileges; review column ACLs';
  END IF;
END;
$$;
COMMIT;
