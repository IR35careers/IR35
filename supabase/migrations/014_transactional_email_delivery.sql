-- =============================================================================
-- Migration 014 - transactional email delivery ledger
-- Records server-side delivery state so welcome emails are sent once per user.
-- Browser roles cannot read recipient or provider-delivery information.
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_delivery_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_type           TEXT NOT NULL CHECK (event_type IN ('welcome')),
  status               TEXT NOT NULL DEFAULT 'processing'
                       CHECK (status IN ('processing', 'sent', 'failed')),
  provider_message_id  TEXT,
  attempts             INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 10),
  error_code           TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at              TIMESTAMPTZ,
  UNIQUE (user_id, event_type)
);

CREATE INDEX IF NOT EXISTS email_delivery_events_status_updated_idx
  ON email_delivery_events (status, updated_at DESC);

ALTER TABLE email_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_delivery_events FROM anon, authenticated;
