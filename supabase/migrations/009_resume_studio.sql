-- =============================================================================
-- Migration 009 - private, user-owned CV tailoring history
-- Raw and tailored CV text is sensitive. Every row is protected by RLS and is
-- readable only by the authenticated owner.
-- =============================================================================

CREATE TABLE IF NOT EXISTS resume_versions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  job_id                  UUID NOT NULL,
  job_title               TEXT NOT NULL,
  company_name            TEXT NOT NULL,
  source_filename         TEXT NOT NULL,
  label                   TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'approved')),
  source_text             TEXT NOT NULL,
  tailored_text           TEXT NOT NULL,
  accepted_suggestion_ids TEXT[] NOT NULL DEFAULT '{}',
  confirmed_keyword_ids   TEXT[] NOT NULL DEFAULT '{}',
  score                   JSONB NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS resume_versions_user_job_created_idx
  ON resume_versions (user_id, job_id, created_at DESC);

ALTER TABLE resume_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own resume versions" ON resume_versions;
CREATE POLICY "Users read own resume versions"
  ON resume_versions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own resume versions" ON resume_versions;
CREATE POLICY "Users insert own resume versions"
  ON resume_versions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own resume versions" ON resume_versions;
CREATE POLICY "Users update own resume versions"
  ON resume_versions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own resume versions" ON resume_versions;
CREATE POLICY "Users delete own resume versions"
  ON resume_versions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
