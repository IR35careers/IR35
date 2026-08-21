-- =============================================================================
-- Migration 017 - security hardening for private mail identity and CV storage
-- =============================================================================

BEGIN;

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

-- Serialize counters for each privacy-hashed scope/key pair so concurrent
-- serverless requests cannot all pass the same count-then-insert window.
CREATE OR REPLACE FUNCTION public.consume_security_rate_limit(
  p_scope TEXT,
  p_rate_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (allowed BOOLEAN, retry_after INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
  v_oldest TIMESTAMPTZ;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_scope IS NULL OR p_scope = ''
     OR p_rate_key IS NULL OR p_rate_key = ''
     OR p_limit < 1 OR p_limit > 10000
     OR p_window_seconds < 1 OR p_window_seconds > 604800 THEN
    RAISE EXCEPTION 'invalid rate-limit input';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_rate_key, 0));
  SELECT COUNT(*)::INTEGER, MIN(created_at)
    INTO v_count, v_oldest
  FROM public.moderation_logs
  WHERE run_type = 'security_rate_limit'
    AND summary->>'scope' = p_scope
    AND summary->>'rate_key' = p_rate_key
    AND created_at >= v_now - make_interval(secs => p_window_seconds);

  IF v_count >= p_limit THEN
    RETURN QUERY SELECT FALSE, GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM ((v_oldest + make_interval(secs => p_window_seconds)) - v_now)))::INTEGER
    );
    RETURN;
  END IF;

  INSERT INTO public.moderation_logs (run_type, summary)
  VALUES ('security_rate_limit', jsonb_build_object('rate_key', p_rate_key, 'scope', p_scope));
  RETURN QUERY SELECT TRUE, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_security_rate_limit(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_security_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO service_role;

-- Candidate browsers may edit only pre-submission packets. Applied state,
-- external handoff mode, receipts and delivery events are service-role output.
DROP POLICY IF EXISTS "Users manage own application packets" ON application_packets;
DROP POLICY IF EXISTS "Users read own application packets" ON application_packets;
DROP POLICY IF EXISTS "Users create own application drafts" ON application_packets;
DROP POLICY IF EXISTS "Users update own application drafts" ON application_packets;
DROP POLICY IF EXISTS "Users delete own application packets" ON application_packets;

CREATE POLICY "Users read own application packets"
  ON application_packets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users create own application drafts"
  ON application_packets FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status IN ('draft', 'ready', 'needs_review')
    AND mode = 'dry_run'
    AND receipt IS NULL
  );
CREATE POLICY "Users update own application drafts"
  ON application_packets FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status IN ('draft', 'ready', 'needs_review'))
  WITH CHECK (
    auth.uid() = user_id
    AND status IN ('draft', 'ready', 'needs_review')
    AND mode = 'dry_run'
    AND receipt IS NULL
  );
CREATE POLICY "Users delete own application packets"
  ON application_packets FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE ON application_packets FROM authenticated;
GRANT INSERT (
  id, user_id, job_id, job_snapshot, status, match_score, resume_version_id,
  resume_version_label, source_cv_text, tailored_cv_text, cover_letter,
  screening_answers, matched_keywords, missing_keywords, truth_approved,
  materials_approved, submission_approved, idempotency_key, created_at,
  updated_at
) ON application_packets TO authenticated;
GRANT UPDATE (
  id, user_id, job_id, job_snapshot, status, match_score, resume_version_id,
  resume_version_label, source_cv_text, tailored_cv_text, cover_letter,
  screening_answers, matched_keywords, missing_keywords, truth_approved,
  materials_approved, submission_approved, updated_at
) ON application_packets TO authenticated;
GRANT SELECT, DELETE ON application_packets TO authenticated;

DROP POLICY IF EXISTS "Users manage own application events" ON application_events;
DROP POLICY IF EXISTS "Users read own application events" ON application_events;
DROP POLICY IF EXISTS "Users add own preparation events" ON application_events;
CREATE POLICY "Users read own application events"
  ON application_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users add own preparation events"
  ON application_events FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND event_type IN ('created', 'prepared', 'approved', 'note')
    AND EXISTS (
      SELECT 1 FROM application_packets packet
      WHERE packet.id = application_id AND packet.user_id = auth.uid()
    )
  );

REVOKE INSERT, UPDATE, DELETE ON application_events FROM authenticated;
GRANT INSERT (
  id, user_id, application_id, event_type, label, metadata,
  idempotency_key, created_at
) ON application_events TO authenticated;
GRANT SELECT ON application_events TO authenticated;

COMMIT;
