-- Feedback support tickets, private attachments and threaded replies.

ALTER TABLE contact_requests
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'Customer feedback',
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('application', 'job_listing', 'account', 'billing', 'accessibility', 'general')),
  ADD COLUMN IF NOT EXISTS page_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS browser_context TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS attachment_path TEXT,
  ADD COLUMN IF NOT EXISTS resolution_summary TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_contact_requests_user_created
  ON contact_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_requests_status_updated
  ON contact_requests (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS feedback_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id     UUID NOT NULL REFERENCES contact_requests (id) ON DELETE CASCADE,
  author_type     TEXT NOT NULL CHECK (author_type IN ('customer', 'admin', 'system')),
  author_user_id  UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  author_email    TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL,
  attachment_path TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_by_user_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feedback_messages_ticket_created
  ON feedback_messages (feedback_id, created_at ASC);

ALTER TABLE feedback_messages ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-attachments',
  'feedback-attachments',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- All feedback access is mediated by authenticated server routes. The storage
-- bucket is private and attachment links are short-lived signed URLs.
