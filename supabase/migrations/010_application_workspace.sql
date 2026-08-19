-- =============================================================================
-- Migration 010 - contractor application workspace
-- Owner-only application packets, event history, inbound message records,
-- preparation rules and entitlements. External submission, mail and billing
-- providers remain disabled until their feature flags and webhook validators
-- are configured.
-- =============================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS application_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS application_packets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  job_id                UUID REFERENCES jobs (id) ON DELETE SET NULL,
  job_snapshot          JSONB NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'needs_review', 'applied', 'viewed', 'replied', 'interview', 'offer', 'rejected', 'withdrawn', 'failed', 'skipped')),
  mode                  TEXT NOT NULL DEFAULT 'dry_run'
                        CHECK (mode IN ('dry_run', 'external_handoff')),
  match_score           INTEGER NOT NULL DEFAULT 0 CHECK (match_score BETWEEN 0 AND 100),
  resume_version_id     UUID REFERENCES resume_versions (id) ON DELETE SET NULL,
  resume_version_label  TEXT NOT NULL DEFAULT '',
  source_cv_text        TEXT NOT NULL DEFAULT '',
  tailored_cv_text      TEXT NOT NULL DEFAULT '',
  cover_letter          TEXT NOT NULL DEFAULT '',
  screening_answers     JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched_keywords      TEXT[] NOT NULL DEFAULT '{}',
  missing_keywords      TEXT[] NOT NULL DEFAULT '{}',
  truth_approved        BOOLEAN NOT NULL DEFAULT FALSE,
  materials_approved    BOOLEAN NOT NULL DEFAULT FALSE,
  submission_approved   BOOLEAN NOT NULL DEFAULT FALSE,
  receipt               JSONB,
  idempotency_key       TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS application_packets_user_updated_idx
  ON application_packets (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS application_packets_user_status_idx
  ON application_packets (user_id, status);

CREATE TABLE IF NOT EXISTS application_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  application_id  UUID NOT NULL REFERENCES application_packets (id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN ('created', 'prepared', 'approved', 'status_changed', 'message_received', 'note')),
  label           TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS application_events_application_created_idx
  ON application_events (application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inbox_aliases (
  user_id             UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  alias               TEXT NOT NULL UNIQUE,
  forwarding_email    TEXT NOT NULL DEFAULT '',
  forwarding_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  provider_state      TEXT NOT NULL DEFAULT 'not_connected'
                      CHECK (provider_state IN ('not_connected', 'sandbox', 'connected')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  application_id       UUID REFERENCES application_packets (id) ON DELETE SET NULL,
  provider_message_id  TEXT,
  sender               TEXT NOT NULL,
  recipient            TEXT NOT NULL,
  subject              TEXT NOT NULL DEFAULT '',
  body_text             TEXT NOT NULL DEFAULT '',
  preview               TEXT NOT NULL DEFAULT '',
  classification        TEXT NOT NULL DEFAULT 'other'
                        CHECK (classification IN ('interview', 'rejection', 'action_required', 'application_update', 'other')),
  is_read               BOOLEAN NOT NULL DEFAULT FALSE,
  received_at           TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS inbox_messages_user_received_idx
  ON inbox_messages (user_id, received_at DESC);

CREATE TABLE IF NOT EXISTS automation_rules (
  user_id                 UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  enabled                 BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run_only            BOOLEAN NOT NULL DEFAULT TRUE CHECK (dry_run_only = TRUE),
  minimum_match           INTEGER NOT NULL DEFAULT 70 CHECK (minimum_match BETWEEN 0 AND 100),
  minimum_day_rate        INTEGER NOT NULL DEFAULT 0 CHECK (minimum_day_rate >= 0),
  ir35_statuses           TEXT[] NOT NULL DEFAULT ARRAY['outside']::TEXT[],
  workplaces              TEXT[] NOT NULL DEFAULT ARRAY['remote', 'hybrid']::TEXT[],
  daily_limit             INTEGER NOT NULL DEFAULT 5 CHECK (daily_limit BETWEEN 1 AND 25),
  prepare_cover_letter    BOOLEAN NOT NULL DEFAULT TRUE,
  require_human_approval  BOOLEAN NOT NULL DEFAULT TRUE CHECK (require_human_approval = TRUE),
  excluded_companies      TEXT[] NOT NULL DEFAULT '{}',
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  mode              TEXT NOT NULL DEFAULT 'dry_run' CHECK (mode = 'dry_run'),
  matching_job_ids  UUID[] NOT NULL DEFAULT '{}',
  skipped           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_entitlements (
  user_id              UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  plan                 TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  preparation_credits  INTEGER NOT NULL DEFAULT 25 CHECK (preparation_credits >= 0),
  billing_state        TEXT NOT NULL DEFAULT 'not_connected'
                       CHECK (billing_state IN ('not_connected', 'sandbox', 'active', 'past_due', 'cancelled')),
  provider_customer_id TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  company     TEXT NOT NULL DEFAULT '',
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'spam')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS articles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL,
  sources      JSONB NOT NULL DEFAULT '[]'::jsonb,
  author_name  TEXT NOT NULL,
  reviewer     TEXT NOT NULL DEFAULT '',
  reviewed_at  TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'published', 'archived')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS testimonials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name   TEXT NOT NULL,
  role_label     TEXT NOT NULL DEFAULT '',
  quote          TEXT NOT NULL,
  consented_at   TIMESTAMPTZ NOT NULL,
  approved_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'withdrawn')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE application_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own application packets" ON application_packets;
CREATE POLICY "Users manage own application packets" ON application_packets FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own application events" ON application_events;
CREATE POLICY "Users manage own application events" ON application_events FOR ALL TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM application_packets packet WHERE packet.id = application_id AND packet.user_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM application_packets packet WHERE packet.id = application_id AND packet.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users manage own inbox alias" ON inbox_aliases;
CREATE POLICY "Users manage own inbox alias" ON inbox_aliases FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own inbox messages" ON inbox_messages;
CREATE POLICY "Users read own inbox messages" ON inbox_messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own inbox messages" ON inbox_messages;
CREATE POLICY "Users update own inbox messages" ON inbox_messages FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE UPDATE ON inbox_messages FROM authenticated;
GRANT UPDATE (is_read) ON inbox_messages TO authenticated;

DROP POLICY IF EXISTS "Users manage own automation rules" ON automation_rules;
CREATE POLICY "Users manage own automation rules" ON automation_rules FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own automation runs" ON automation_runs;
CREATE POLICY "Users read own automation runs" ON automation_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own entitlements" ON user_entitlements;
CREATE POLICY "Users read own entitlements" ON user_entitlements FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Public content is readable only after editorial review/consent. Contact
-- requests have no public policy and are inserted by the server secret client.
DROP POLICY IF EXISTS "Published articles are public" ON articles;
CREATE POLICY "Published articles are public" ON articles FOR SELECT TO anon, authenticated
  USING (status = 'published' AND published_at IS NOT NULL);

DROP POLICY IF EXISTS "Approved testimonials are public" ON testimonials;
CREATE POLICY "Approved testimonials are public" ON testimonials FOR SELECT TO anon, authenticated
  USING (status = 'approved' AND approved_at IS NOT NULL AND consented_at IS NOT NULL);
