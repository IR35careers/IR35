-- =============================================================================
-- IR35Careers — Jobs schema (migration 001)
-- Run this in the Supabase SQL Editor.
--
-- Creates:
--   • jobs             — contract listings with full-text search
--   • moderation_logs  — pipeline run audit trail
--
-- Design notes:
--   • (source_domain, source_identifier) UNIQUE → deterministic dedup; the
--     fetch pipeline upserts on this key, so re-fetching never duplicates.
--   • search_vector is a GENERATED column → always in sync, no triggers.
--   • Partial indexes (WHERE expired_at IS NULL) → only active jobs are
--     indexed, keeping indexes small and hot.
--   • RLS: the public (anon) can read active jobs only. Writes happen solely
--     through server-side code using the secret/service key, which bypasses
--     RLS by design — so no write policies are needed here.
--   • User-facing tables (saved jobs, alerts, applications) arrive in a later
--     migration alongside authentication.
-- =============================================================================

-- ── jobs ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  title             TEXT NOT NULL,
  company_name      TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  location          TEXT NOT NULL DEFAULT 'Unknown',

  remote_type       TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (remote_type IN ('remote', 'hybrid', 'onsite', 'unknown')),

  ir35_status       TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (ir35_status IN ('inside', 'outside', 'unknown')),
  ir35_confidence   TEXT NOT NULL DEFAULT 'low'
                    CHECK (ir35_confidence IN ('high', 'medium', 'low')),

  rate_min          INTEGER,
  rate_max          INTEGER,
  rate_currency     TEXT,
  rate_type         TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (rate_type IN ('daily', 'hourly', 'annual', 'unknown')),
  rate_confidence   TEXT NOT NULL DEFAULT 'low'
                    CHECK (rate_confidence IN ('high', 'medium', 'low')),
  rate_raw          TEXT NOT NULL DEFAULT '',

  skills            TEXT[] NOT NULL DEFAULT '{}',

  apply_url         TEXT NOT NULL,

  source_domain     TEXT NOT NULL,
  source_identifier TEXT NOT NULL,
  source_type       TEXT NOT NULL DEFAULT 'unknown',

  posted_at         TIMESTAMPTZ,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expired_at        TIMESTAMPTZ,

  raw_payload       JSONB,

  search_vector     TSVECTOR GENERATED ALWAYS AS (
                      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                      setweight(to_tsvector('english', coalesce(company_name, '')), 'B') ||
                      setweight(to_tsvector('english', coalesce(description, '')), 'C')
                    ) STORED,

  CONSTRAINT jobs_source_unique UNIQUE (source_domain, source_identifier)
);

-- ── Indexes (partial: active jobs only) ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jobs_search
  ON jobs USING GIN (search_vector) WHERE expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_skills
  ON jobs USING GIN (skills) WHERE expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_ir35
  ON jobs (ir35_status) WHERE expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_remote
  ON jobs (remote_type) WHERE expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_rate_min
  ON jobs (rate_min) WHERE expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_rate_max
  ON jobs (rate_max) WHERE expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_posted
  ON jobs (posted_at DESC NULLS LAST) WHERE expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_last_seen
  ON jobs (last_seen_at);

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active jobs" ON jobs;
CREATE POLICY "Public can read active jobs"
  ON jobs FOR SELECT
  TO anon, authenticated
  USING (expired_at IS NULL);

-- ── moderation_logs (pipeline audit trail) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS moderation_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type    TEXT NOT NULL,          -- e.g. 'fetch_jobs', 'expire_stale'
  summary     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE moderation_logs ENABLE ROW LEVEL SECURITY;
-- No anon policies: only server-side code (service key) reads/writes logs.
