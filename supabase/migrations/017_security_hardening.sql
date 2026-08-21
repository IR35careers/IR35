-- =============================================================================
-- Migration 017 - security hardening for private mail identity and CV storage
-- =============================================================================

-- Application aliases and forwarding destinations are assigned and maintained
-- only by trusted server routes. Account holders may read their own row.
DROP POLICY IF EXISTS "Users manage own inbox alias" ON inbox_aliases;
DROP POLICY IF EXISTS "Users read own inbox alias" ON inbox_aliases;
CREATE POLICY "Users read own inbox alias"
  ON inbox_aliases FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON inbox_aliases FROM authenticated;
GRANT SELECT ON inbox_aliases TO authenticated;

-- Keep direct browser uploads inside the same bounds enforced by the UI and
-- server parsers. The bucket remains private and owner-folder RLS still applies.
UPDATE storage.buckets
SET file_size_limit = 8388608,
    allowed_mime_types = ARRAY[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]::text[]
WHERE id = 'cvs';

DROP POLICY IF EXISTS "CV owners update" ON storage.objects;
CREATE POLICY "CV owners update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cvs' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'cvs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE INDEX IF NOT EXISTS moderation_logs_security_rate_idx
  ON moderation_logs (run_type, (summary->>'scope'), (summary->>'rate_key'), created_at DESC)
  WHERE run_type = 'security_rate_limit';
