-- Read-only verification for migration 017_security_hardening.sql.
-- Run this after the migration in the production Supabase SQL Editor.

SELECT
  to_regprocedure('public.consume_security_rate_limit(text,text,integer,integer)') IS NOT NULL
    AS atomic_rate_limit_function_exists,
  has_function_privilege(
    'service_role',
    'public.consume_security_rate_limit(text,text,integer,integer)',
    'EXECUTE'
  ) AS service_role_can_execute_rate_limit,
  NOT has_function_privilege(
    'authenticated',
    'public.consume_security_rate_limit(text,text,integer,integer)',
    'EXECUTE'
  ) AS authenticated_cannot_execute_rate_limit,
  NOT has_function_privilege(
    'anon',
    'public.consume_security_rate_limit(text,text,integer,integer)',
    'EXECUTE'
  ) AS anonymous_cannot_execute_rate_limit;

SELECT
  relname AS table_name,
  relrowsecurity AS row_level_security_enabled
FROM pg_class
WHERE oid IN (
  'public.application_packets'::regclass,
  'public.application_events'::regclass,
  'public.inbox_aliases'::regclass
)
ORDER BY relname;

SELECT
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('application_packets', 'application_events', 'inbox_aliases')
ORDER BY tablename, policyname;

SELECT
  NOT has_column_privilege('authenticated', 'public.application_packets', 'receipt', 'UPDATE')
    AS browser_cannot_update_receipt,
  NOT has_column_privilege('authenticated', 'public.application_packets', 'mode', 'UPDATE')
    AS browser_cannot_update_submission_mode,
  has_column_privilege('authenticated', 'public.application_packets', 'status', 'UPDATE')
    AS browser_can_update_draft_status,
  NOT has_table_privilege('authenticated', 'public.application_events', 'UPDATE')
    AS browser_cannot_update_events,
  NOT has_table_privilege('authenticated', 'public.application_events', 'DELETE')
    AS browser_cannot_delete_events,
  NOT has_table_privilege('authenticated', 'public.inbox_aliases', 'INSERT')
    AS browser_cannot_create_alias,
  NOT has_table_privilege('authenticated', 'public.inbox_aliases', 'UPDATE')
    AS browser_cannot_change_alias,
  NOT has_table_privilege('authenticated', 'public.inbox_aliases', 'DELETE')
    AS browser_cannot_delete_alias;

SELECT
  id,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE id = 'cvs';
