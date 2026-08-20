-- =============================================================================
-- Migration 011 - billing provider reconciliation
-- Stripe checkout remains disabled unless ENABLE_BILLING and every required
-- server-side credential are configured. Browser roles cannot access provider
-- identifiers or webhook delivery records.
-- =============================================================================

ALTER TABLE user_entitlements
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS user_entitlements_provider_customer_idx
  ON user_entitlements (provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_consents (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                      UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  checkout_request_key         TEXT NOT NULL,
  policy_version               TEXT NOT NULL,
  price_label                  TEXT NOT NULL,
  immediate_access_requested   BOOLEAN NOT NULL CHECK (immediate_access_requested = TRUE),
  status                       TEXT NOT NULL DEFAULT 'initiated'
                               CHECK (status IN ('initiated', 'checkout_created', 'checkout_completed')),
  provider_checkout_session_id TEXT,
  consented_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, checkout_request_key)
);

CREATE INDEX IF NOT EXISTS billing_consents_user_idx ON billing_consents (user_id, consented_at DESC);
ALTER TABLE billing_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_consents FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id      TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  livemode      BOOLEAN NOT NULL,
  status        TEXT NOT NULL DEFAULT 'processing'
                CHECK (status IN ('processing', 'completed', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_error    TEXT NOT NULL DEFAULT '',
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);

ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_webhook_events FROM anon, authenticated;

-- Provider IDs are managed by server-side checkout/webhook routes only.
REVOKE UPDATE (provider_customer_id, provider_subscription_id, plan, preparation_credits, billing_state)
  ON user_entitlements FROM authenticated;
