-- Durable queue for the IR35Careers-owned, long-running employer portal worker.
-- Candidate material remains in the existing profile and packet tables. This
-- queue stores only routing and lease metadata and is service-role only.

CREATE TABLE IF NOT EXISTS application_worker_tasks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  application_id     UUID NOT NULL REFERENCES application_packets (id) ON DELETE CASCADE,
  idempotency_key    TEXT NOT NULL,
  destination        TEXT NOT NULL,
  callback_url       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'completed', 'needs_user', 'failed', 'cancelled')),
  attempts           INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner        TEXT,
  lease_expires_at   TIMESTAMPTZ,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS application_worker_tasks_ready_idx
  ON application_worker_tasks (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS application_worker_tasks_application_idx
  ON application_worker_tasks (application_id, updated_at DESC);

ALTER TABLE application_worker_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON application_worker_tasks FROM anon, authenticated;

CREATE OR REPLACE FUNCTION claim_application_worker_task(p_worker_id TEXT)
RETURNS SETOF application_worker_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed application_worker_tasks;
BEGIN
  UPDATE application_worker_tasks
  SET
    status = 'failed',
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_error = COALESCE(last_error, 'The worker lease expired after the final retry.'),
    completed_at = NOW(),
    updated_at = NOW()
  WHERE status = 'running'
    AND lease_expires_at < NOW()
    AND attempts >= 5;

  UPDATE application_worker_tasks
  SET
    status = 'running',
    attempts = attempts + 1,
    lease_owner = LEFT(p_worker_id, 120),
    lease_expires_at = NOW() + INTERVAL '6 minutes',
    updated_at = NOW()
  WHERE id = (
    SELECT id
    FROM application_worker_tasks
    WHERE
      available_at <= NOW()
      AND attempts < 5
      AND (
        status = 'queued'
        OR (status = 'running' AND lease_expires_at < NOW())
      )
    ORDER BY available_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO claimed;

  IF claimed.id IS NOT NULL THEN
    RETURN NEXT claimed;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION claim_application_worker_task(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_application_worker_task(TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS application_worker_heartbeats (
  worker_id      TEXT PRIMARY KEY,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active         INTEGER NOT NULL DEFAULT 0 CHECK (active >= 0),
  concurrency    INTEGER NOT NULL DEFAULT 1 CHECK (concurrency BETWEEN 1 AND 20),
  completed      INTEGER NOT NULL DEFAULT 0 CHECK (completed >= 0),
  failed         INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  version        TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS application_worker_heartbeats_seen_idx
  ON application_worker_heartbeats (last_seen_at DESC);

ALTER TABLE application_worker_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON application_worker_heartbeats FROM anon, authenticated;
