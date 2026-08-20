-- Production submission queue. Only the server secret client may write;
-- authenticated users can read the state and receipt for their own packets.

CREATE TABLE IF NOT EXISTS application_submissions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  application_id           UUID NOT NULL REFERENCES application_packets (id) ON DELETE CASCADE,
  provider_name            TEXT NOT NULL,
  provider_submission_id   TEXT,
  idempotency_key          TEXT NOT NULL,
  payload_hash             TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  receipt                  JSONB,
  error_code               TEXT,
  submitted_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS application_submissions_user_updated_idx
  ON application_submissions (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS application_submissions_application_idx
  ON application_submissions (application_id);

ALTER TABLE application_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own submission receipts" ON application_submissions;
CREATE POLICY "Users read own submission receipts" ON application_submissions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON application_submissions FROM authenticated;
GRANT SELECT ON application_submissions TO authenticated;

-- Preview runs are user-owned decision logs. Allow users to persist only
-- their own generated previews; no application can be submitted from them.
DROP POLICY IF EXISTS "Users read own automation runs" ON automation_runs;
DROP POLICY IF EXISTS "Users manage own automation runs" ON automation_runs;
CREATE POLICY "Users manage own automation runs" ON automation_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
