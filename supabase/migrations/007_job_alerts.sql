-- Migration 007 — saved searches ("job alerts"). Run in the SQL Editor.
-- Stores a named search; email delivery is added later when an email service
-- is connected. For now users manage alerts and can open each as a live search.

CREATE TABLE IF NOT EXISTS job_alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT '',
  q          TEXT,
  ir35       TEXT CHECK (ir35 IN ('outside', 'inside')),
  remote     TEXT CHECK (remote IN ('remote', 'hybrid', 'onsite')),
  min_rate   INTEGER,
  skills     TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE job_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own alerts" ON job_alerts;
CREATE POLICY "Users manage own alerts"
  ON job_alerts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
