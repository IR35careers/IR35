-- Short-lived employer browser sessions let an approved application resume
-- after an ordinary missing-answer or email-verification interruption. The
-- browser state is encrypted by the application before it reaches this table.

CREATE TABLE IF NOT EXISTS application_portal_sessions (
  application_id  UUID PRIMARY KEY REFERENCES application_packets (id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  destination_host TEXT NOT NULL,
  encrypted_state TEXT NOT NULL CHECK (octet_length(encrypted_state) <= 1000000),
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS application_portal_sessions_user_expiry_idx
  ON application_portal_sessions (user_id, expires_at DESC);

ALTER TABLE application_portal_sessions ENABLE ROW LEVEL SECURITY;

-- No browser-session data is exposed to authenticated browser clients. Only
-- the server-side secret client may read or write these encrypted records.
REVOKE ALL ON application_portal_sessions FROM anon, authenticated;
