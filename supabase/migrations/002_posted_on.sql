-- =============================================================================
-- Migration 002 — posted_on date column for day-level ordering
--
-- Problem: some sources give precise timestamps ("today 09:14"), others only
-- a date (stored as midnight). Ordering by the raw timestamp means the rate
-- tiebreaker never fires — timestamps almost never tie. Ranking by the DAY
-- first lets all of today's jobs tie, then rate breaks the tie, so listings
-- with real rates lead the page.
-- =============================================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS posted_on DATE
  GENERATED ALWAYS AS (
    ((COALESCE(posted_at, first_seen_at)) AT TIME ZONE 'UTC')::date
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_jobs_posted_on
  ON jobs (posted_on DESC) WHERE expired_at IS NULL;
