-- Preparation only: run before enabling Railway consumption. No jobs are
-- requeued, no customer data deleted, and no existing RLS policy is relaxed.
BEGIN;
CREATE SCHEMA IF NOT EXISTS pgboss;
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fail_abandoned_application_tasks()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE task RECORD; affected INTEGER := 0;
BEGIN
  FOR task IN
    SELECT id, user_id, application_id, attempts
    FROM public.application_worker_tasks
    WHERE status = 'running' AND updated_at < NOW() - INTERVAL '10 minutes'
      AND lease_owner LIKE 'railway-%'
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.application_worker_tasks SET status = 'failed',
      last_error = 'runner_timeout', lease_owner = NULL, lease_expires_at = NULL,
      completed_at = NOW(), updated_at = NOW() WHERE id = task.id;
    UPDATE public.application_submissions SET status = 'failed', error_code = 'runner_timeout',
      receipt = jsonb_build_object('state', 'failed', 'message',
        'The worker stopped before confirmation. Check the employer outcome before an explicit retry.'),
      updated_at = NOW()
      WHERE application_id = task.application_id AND user_id = task.user_id
        AND status NOT IN ('succeeded', 'cancelled');
    UPDATE public.application_packets SET status = 'failed', updated_at = NOW()
      WHERE id = task.application_id AND user_id = task.user_id
        AND status IN ('draft', 'ready', 'needs_review');
    INSERT INTO public.application_events(user_id, application_id, event_type, label, metadata, idempotency_key)
      VALUES (task.user_id, task.application_id, 'status_changed', 'Application worker timed out',
        jsonb_build_object('failure_reason', 'runner_timeout', 'worker_attempt', task.attempts),
        'railway-timeout:' || task.id || ':' || task.attempts)
      ON CONFLICT (user_id, idempotency_key) DO NOTHING;
    affected := affected + 1;
  END LOOP;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_abandoned_application_tasks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_abandoned_application_tasks() TO service_role;
COMMIT;
