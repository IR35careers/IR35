-- =============================================================================
-- Migration 003 — user profiles, saved jobs, and private CV storage
-- Run in the Supabase SQL Editor.
-- =============================================================================

-- ── profiles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id               UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL DEFAULT '',
  target_rate_min  INTEGER,
  preferred_ir35   TEXT NOT NULL DEFAULT 'either'
                   CHECK (preferred_ir35 IN ('outside', 'inside', 'either')),
  preferred_remote TEXT NOT NULL DEFAULT 'any'
                   CHECK (preferred_remote IN ('remote', 'hybrid', 'onsite', 'any')),
  skills           TEXT[] NOT NULL DEFAULT '{}',
  cv_path          TEXT,
  cv_filename      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own profile" ON profiles;
CREATE POLICY "Users manage own profile"
  ON profiles FOR ALL
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── saved_jobs (applications tracker) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_jobs (
  user_id    UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  job_id     UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'applied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, job_id)
);

ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own saved jobs" ON saved_jobs;
CREATE POLICY "Users manage own saved jobs"
  ON saved_jobs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Private CV storage bucket ───────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('cvs', 'cvs', false)
ON CONFLICT (id) DO NOTHING;

-- Each user can only touch files inside their own folder: cvs/{their-uid}/...
DROP POLICY IF EXISTS "CV owners insert" ON storage.objects;
CREATE POLICY "CV owners insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cvs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "CV owners read" ON storage.objects;
CREATE POLICY "CV owners read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cvs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "CV owners update" ON storage.objects;
CREATE POLICY "CV owners update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cvs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "CV owners delete" ON storage.objects;
CREATE POLICY "CV owners delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cvs' AND (storage.foldername(name))[1] = auth.uid()::text);
