-- Additive: preserve packet/CV, recruiting stages, receipts and all history.
-- delivery_status is authoritative; legacy status is a compatibility projection.
BEGIN;
ALTER TABLE public.application_packets
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN delivery_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN failure_reason text,
  ADD COLUMN error_detail text,
  ADD COLUMN delivery_started_at timestamptz,
  ADD CONSTRAINT application_delivery_status_check CHECK (delivery_status IN (
    'draft','needs_profile','awaiting_approval','queued','submitting',
    'submitted','needs_info','failed','external_only','skipped'));
ALTER TABLE public.application_events
  ADD COLUMN from_status text,
  ADD COLUMN to_status text,
  ADD COLUMN failure_reason text,
  ADD COLUMN error_detail text;
ALTER TABLE public.application_worker_tasks ADD COLUMN attempt_base integer NOT NULL DEFAULT 0 CHECK(attempt_base>=0);

-- Conservative historical backfill. Never turn queue acceptance into submission.
UPDATE public.application_packets p SET delivery_status = CASE
  WHEN p.status IN ('applied','viewed','replied','interview','offer','rejected','withdrawn')
    AND p.receipt->>'receiptId' IS NOT NULL THEN 'submitted'
  WHEN p.status = 'skipped' THEN 'skipped'
  WHEN p.status = 'failed' OR EXISTS (SELECT 1 FROM public.application_worker_tasks t
    WHERE t.application_id=p.id AND t.status='failed') THEN 'failed'
  WHEN EXISTS (SELECT 1 FROM public.application_worker_tasks t
    WHERE t.application_id=p.id AND t.status='running') THEN 'submitting'
  WHEN EXISTS (SELECT 1 FROM public.application_worker_tasks t
    WHERE t.application_id=p.id AND t.status='queued') THEN 'queued'
  WHEN EXISTS (SELECT 1 FROM public.application_submissions s
    WHERE s.application_id=p.id AND (s.error_code='needs_user' OR s.receipt->>'state'='needs_user'))
    OR EXISTS (SELECT 1 FROM public.application_worker_tasks t WHERE t.application_id=p.id AND t.status='needs_user')
    THEN 'needs_info'
  WHEN p.status IN ('ready','needs_review') THEN 'awaiting_approval'
  ELSE 'draft' END;
UPDATE public.application_packets p SET delivery_status='external_only',
  failure_reason='unsupported_aggregator', error_detail='No supported employer application destination was resolved.'
  WHERE p.delivery_status='needs_info' AND EXISTS (
    SELECT 1 FROM public.application_worker_tasks t WHERE t.application_id=p.id
    AND t.destination ~* '^https://([a-z0-9-]+\.)*(adzuna|reed)\.co\.uk(/|$)');
UPDATE public.application_packets SET failure_reason=COALESCE(failure_reason,
  CASE delivery_status WHEN 'failed' THEN 'legacy_worker_failure' WHEN 'needs_info' THEN 'employer_action_required' END)
  WHERE delivery_status IN ('failed','needs_info');
INSERT INTO public.application_events(user_id,application_id,event_type,label,metadata,idempotency_key,to_status,failure_reason,error_detail)
  SELECT user_id,id,'status_changed','Stored delivery lifecycle established',
    jsonb_build_object('migration','025','to_status',delivery_status,'failure_reason',failure_reason),
    'delivery-backfill:'||id,delivery_status,failure_reason,error_detail
  FROM public.application_packets ON CONFLICT(user_id,idempotency_key) DO NOTHING;

CREATE FUNCTION public.application_delivery_can_transition(p_from text,p_to text,p_retry boolean DEFAULT false)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p_from=p_to THEN true
    WHEN p_retry THEN p_from IN ('needs_info','failed','external_only') AND p_to='queued'
    WHEN p_from IN ('submitted','needs_info','failed','external_only','skipped') THEN false
    WHEN p_to IN ('submitted','needs_info','failed','external_only','skipped') THEN true
    ELSE array_position(ARRAY['draft','needs_profile','awaiting_approval','queued','submitting'],p_to)
      > array_position(ARRAY['draft','needs_profile','awaiting_approval','queued','submitting'],p_from) END
$$;

CREATE FUNCTION public.guard_application_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate text;
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.delivery_status := CASE WHEN NEW.status='ready' THEN 'awaiting_approval' ELSE 'draft' END;
    NEW.delivery_version := 1;
  ELSE
    -- Legacy service code cannot reset the lifecycle by saving a ready snapshot.
    IF NEW.delivery_status=OLD.delivery_status THEN
      candidate := CASE
        WHEN NEW.status='applied' AND NEW.receipt->>'receiptId' IS NOT NULL THEN 'submitted'
        WHEN NEW.status='failed' AND OLD.status IS DISTINCT FROM NEW.status THEN 'failed'
        WHEN NEW.status='skipped' AND OLD.status IS DISTINCT FROM NEW.status THEN 'skipped'
        WHEN NEW.status='needs_review' AND OLD.delivery_status IN ('queued','submitting') THEN 'needs_info'
        WHEN NEW.status='ready' AND OLD.delivery_status IN ('draft','needs_profile') THEN 'awaiting_approval'
        ELSE OLD.delivery_status END;
      IF public.application_delivery_can_transition(OLD.delivery_status,candidate,false) THEN
        NEW.delivery_status := candidate;
      END IF;
    END IF;
    IF NOT COALESCE(public.application_delivery_can_transition(OLD.delivery_status,NEW.delivery_status,
      current_setting('ir35.explicit_retry',true)=OLD.id::text),false) THEN
      RAISE EXCEPTION 'Delivery status cannot move backwards; use explicit Retry' USING ERRCODE='40001';
    END IF;
    IF OLD.delivery_status='submitted' AND NEW.receipt IS DISTINCT FROM OLD.receipt THEN
      RAISE EXCEPTION 'A confirmed receipt cannot be overwritten' USING ERRCODE='40001';
    END IF;
    NEW.delivery_version := OLD.delivery_version+1;
  END IF;
  IF NEW.delivery_status='submitted' AND (COALESCE(NEW.receipt->>'receiptId','')='' OR COALESCE(NEW.receipt->>'destination','')='') THEN
    RAISE EXCEPTION 'Submission requires an employer confirmation receipt';
  END IF;
  IF NEW.delivery_status IN ('queued','submitting') AND NOT (NEW.truth_approved AND NEW.materials_approved AND NEW.submission_approved) THEN
    RAISE EXCEPTION 'Delivery requires all candidate approvals';
  END IF;
  IF NEW.delivery_status IN ('needs_info','failed','external_only','skipped') THEN
    NEW.failure_reason := COALESCE(NULLIF(NEW.failure_reason,''),CASE NEW.delivery_status
      WHEN 'external_only' THEN 'unsupported_destination' WHEN 'failed' THEN 'worker_failure'
      WHEN 'skipped' THEN 'skipped' ELSE 'employer_action_required' END);
  ELSIF TG_OP='INSERT' OR NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    NEW.failure_reason := NULL; NEW.error_detail := NULL;
  END IF;
  IF NEW.delivery_status='submitting' AND (TG_OP='INSERT' OR OLD.delivery_status<>'submitting') THEN
    NEW.delivery_started_at := clock_timestamp();
  END IF;
  -- Retain recruiting-stage values after submitted; delivery remains submitted.
  NEW.status := CASE NEW.delivery_status
    WHEN 'queued' THEN 'ready' WHEN 'submitting' THEN 'ready'
    WHEN 'needs_info' THEN 'needs_review' WHEN 'external_only' THEN 'needs_review'
    WHEN 'failed' THEN 'failed' WHEN 'skipped' THEN 'skipped'
    WHEN 'submitted' THEN CASE WHEN NEW.status IN ('applied','viewed','replied','interview','offer','rejected','withdrawn') THEN NEW.status ELSE 'applied' END
    ELSE NEW.status END;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER application_delivery_guard BEFORE INSERT OR UPDATE ON public.application_packets
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_delivery();
CREATE FUNCTION public.audit_application_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.delivery_status=NEW.delivery_status THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN previous:=OLD.delivery_status; END IF;
  INSERT INTO public.application_events(user_id,application_id,event_type,label,metadata,idempotency_key,
    from_status,to_status,failure_reason,error_detail)
    VALUES(NEW.user_id,NEW.id,'status_changed','Delivery: '||NEW.delivery_status,
      jsonb_build_object('from_status',previous,'to_status',NEW.delivery_status,'failure_reason',NEW.failure_reason,
        'error_detail',NEW.error_detail,'delivery_version',NEW.delivery_version),
      'delivery:'||NEW.id||':'||NEW.delivery_version,previous,NEW.delivery_status,NEW.failure_reason,NEW.error_detail);
  RETURN NEW;
END;
$$;
CREATE TRIGGER application_delivery_audit AFTER INSERT OR UPDATE ON public.application_packets
  FOR EACH ROW EXECUTE FUNCTION public.audit_application_delivery();

-- This is the only explicit backwards edge. The server must validate fresh
-- profile readiness and user intent before invoking this service-only RPC.
CREATE FUNCTION public.transition_application_delivery(p_id uuid,p_user_id uuid,p_to text,
  p_reason text DEFAULT NULL,p_detail text DEFAULT NULL,p_retry boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE packet public.application_packets;
BEGIN
  SELECT * INTO STRICT packet FROM public.application_packets WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF NOT COALESCE(public.application_delivery_can_transition(packet.delivery_status,p_to,p_retry),false) THEN
    RAISE EXCEPTION 'Delivery transition rejected' USING ERRCODE='40001';
  END IF;
  IF packet.delivery_status=p_to THEN RETURN to_jsonb(packet); END IF;
  IF p_retry THEN PERFORM set_config('ir35.explicit_retry',p_id::text,true); END IF;
  UPDATE public.application_packets SET delivery_status=p_to,failure_reason=left(p_reason,100),error_detail=left(p_detail,2000)
    WHERE id=p_id RETURNING * INTO packet;
  IF p_retry THEN PERFORM set_config('ir35.explicit_retry','',true); END IF;
  RETURN to_jsonb(packet);
END;
$$;
REVOKE ALL ON FUNCTION public.transition_application_delivery(uuid,uuid,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transition_application_delivery(uuid,uuid,text,text,text,boolean) TO service_role;

-- Commit the canonical outcome, legacy transport projections, task completion
-- and transition event atomically. Lost callback acknowledgements are idempotent.
CREATE FUNCTION public.commit_application_delivery_result(p_id uuid,p_user_id uuid,p_to text,
  p_receipt jsonb,p_questions jsonb DEFAULT NULL,p_keep_approval boolean DEFAULT true,
  p_reason text DEFAULT NULL,p_detail text DEFAULT NULL,p_task_id uuid DEFAULT NULL,p_attempt integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE packet public.application_packets; task public.application_worker_tasks;
BEGIN
  IF p_to NOT IN ('submitted','needs_info','failed','external_only','skipped') OR jsonb_typeof(p_receipt)<>'object' THEN
    RAISE EXCEPTION 'Invalid delivery result';
  END IF;
  -- Lock transport rows before the packet, matching the claim/watchdog order.
  PERFORM 1 FROM public.application_worker_tasks WHERE application_id=p_id AND user_id=p_user_id FOR UPDATE;
  IF p_task_id IS NOT NULL THEN
    SELECT * INTO STRICT task FROM public.application_worker_tasks
      WHERE id=p_task_id AND application_id=p_id AND user_id=p_user_id FOR UPDATE;
    IF task.status IN ('completed','cancelled','failed') OR task.attempts IS DISTINCT FROM p_attempt THEN
      RETURN jsonb_build_object('duplicate',true);
    END IF;
  END IF;
  SELECT * INTO STRICT packet FROM public.application_packets WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF packet.delivery_status=p_to THEN RETURN to_jsonb(packet); END IF;
  IF NOT COALESCE(public.application_delivery_can_transition(packet.delivery_status,p_to,false),false) THEN
    RAISE EXCEPTION 'Delivery outcome belongs to a completed attempt' USING ERRCODE='40001';
  END IF;
  UPDATE public.application_packets SET delivery_status=p_to,failure_reason=left(p_reason,100),error_detail=left(p_detail,2000),
    screening_answers=COALESCE(p_questions,screening_answers),submission_approved=submission_approved AND p_keep_approval,
    mode=CASE WHEN p_to='submitted' THEN 'external_handoff' ELSE mode END,
    receipt=CASE WHEN p_to='submitted' THEN p_receipt ELSE receipt END
    WHERE id=p_id RETURNING * INTO packet;
  UPDATE public.application_submissions SET
    status=CASE p_to WHEN 'submitted' THEN 'succeeded' WHEN 'needs_info' THEN 'processing' WHEN 'skipped' THEN 'cancelled' ELSE 'failed' END,
    error_code=CASE WHEN p_to='submitted' THEN NULL ELSE COALESCE(p_reason,p_to) END,
    receipt=p_receipt,submitted_at=CASE WHEN p_to='submitted' THEN (p_receipt->>'createdAt')::timestamptz ELSE NULL END,
    provider_submission_id=CASE WHEN p_to='submitted' THEN p_receipt->>'receiptId' ELSE provider_submission_id END,
    updated_at=clock_timestamp() WHERE application_id=p_id AND user_id=p_user_id;
  UPDATE public.application_worker_tasks SET
    status=CASE p_to WHEN 'submitted' THEN 'completed' WHEN 'needs_info' THEN 'needs_user' WHEN 'failed' THEN 'failed' ELSE 'cancelled' END,
    last_error=CASE WHEN p_to='submitted' THEN NULL ELSE COALESCE(p_reason,p_to) END,
    lease_owner=NULL,lease_expires_at=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE application_id=p_id AND user_id=p_user_id AND (p_task_id IS NULL OR id=p_task_id);
  RETURN to_jsonb(packet);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_application_delivery_result(uuid,uuid,text,jsonb,jsonb,boolean,text,text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_application_delivery_result(uuid,uuid,text,jsonb,jsonb,boolean,text,text,uuid,integer) TO service_role;

-- The legacy task queue still controls leases; a task update and its canonical
-- delivery transition/event now commit in the same transaction.
CREATE FUNCTION public.project_application_task_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE packet public.application_packets; target text; reason text;
BEGIN
  SELECT * INTO packet FROM public.application_packets WHERE id=NEW.application_id AND user_id=NEW.user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  target := CASE NEW.status WHEN 'queued' THEN 'queued' WHEN 'running' THEN 'submitting'
    WHEN 'failed' THEN 'failed' WHEN 'needs_user' THEN 'needs_info' ELSE NULL END;
  IF NEW.status IN ('queued','running') AND packet.delivery_status IN ('submitted','needs_info','failed','external_only','skipped') THEN
    RAISE EXCEPTION 'A completed attempt requires explicit Retry' USING ERRCODE='40001';
  END IF;
  IF target IS NULL OR NOT COALESCE(public.application_delivery_can_transition(packet.delivery_status,target,false),false)
    OR packet.delivery_status=target THEN RETURN NEW; END IF;
  reason := CASE WHEN target='failed' THEN COALESCE(NULLIF(NEW.last_error,''),'worker_crash')
    WHEN target='needs_info' THEN 'employer_action_required' ELSE NULL END;
  PERFORM public.transition_application_delivery(NEW.application_id,NEW.user_id,target,reason,NULL,false);
  RETURN NEW;
END;
$$;
CREATE TRIGGER application_task_delivery AFTER INSERT OR UPDATE OF status ON public.application_worker_tasks
  FOR EACH ROW EXECUTE FUNCTION public.project_application_task_delivery();
CREATE FUNCTION public.guard_application_task_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  -- Absolute attempt IDs never repeat, including after an explicit Retry.
  NEW.attempts:=GREATEST(OLD.attempts,NEW.attempts);
  IF NEW.status='queued' AND OLD.status IN ('failed','needs_user','cancelled') THEN
    NEW.attempt_base:=OLD.attempts;
  ELSE NEW.attempt_base:=OLD.attempt_base; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER application_task_attempt_guard BEFORE UPDATE ON public.application_worker_tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_task_attempt();
CREATE FUNCTION public.claim_application_delivery_task(p_worker_id text,p_application_id uuid DEFAULT NULL)
RETURNS SETOF public.application_worker_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE task public.application_worker_tasks;
BEGIN
  IF length(p_worker_id)<3 OR length(p_worker_id)>120 THEN RAISE EXCEPTION 'Invalid worker ID'; END IF;
  -- Never reclaim a running/unknown outcome. Only the watchdog may fail it.
  SELECT * INTO task FROM public.application_worker_tasks t WHERE t.status='queued'
    AND (p_application_id IS NULL OR t.application_id=p_application_id) AND t.available_at<=now()
    AND t.attempts<t.attempt_base+3 ORDER BY t.available_at,t.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.application_worker_tasks SET status='running',attempts=attempts+1,lease_owner=p_worker_id,
    lease_expires_at=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp()
    WHERE id=task.id RETURNING * INTO task;
  RETURN NEXT task;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_application_delivery_task(text,uuid),public.guard_application_task_attempt() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_application_delivery_task(text,uuid) TO service_role;

-- Browser drafts use compare-and-swap. No direct UPDATE/UPSERT can bypass it,
-- and no caller can set delivery status, receipts, mode, user ID or events.
REVOKE INSERT,UPDATE ON public.application_packets FROM authenticated;
-- Revoke the old column grants too (table revocation alone does not remove them).
DO $$ DECLARE col record; BEGIN
  FOR col IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='application_packets' LOOP
    EXECUTE format('REVOKE INSERT (%I), UPDATE (%I) ON public.application_packets FROM authenticated',col.column_name,col.column_name);
  END LOOP;
END $$;
CREATE FUNCTION public.save_application_draft(p_packet jsonb,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE packet public.application_packets; existing public.application_packets; owner_id uuid:=auth.uid();
BEGIN
  IF owner_id IS NULL OR p_expected_version IS NULL OR p_expected_version<0 OR jsonb_typeof(p_packet)<>'object' OR octet_length(p_packet::text)>750000 THEN
    RAISE EXCEPTION 'Invalid application draft' USING ERRCODE='42501';
  END IF;
  SELECT * INTO packet FROM jsonb_populate_record(NULL::public.application_packets,p_packet);
  IF packet.id IS NULL OR packet.status NOT IN ('draft','ready','needs_review') OR packet.job_snapshot IS NULL THEN
    RAISE EXCEPTION 'Invalid draft fields';
  END IF;
  SELECT * INTO existing FROM public.application_packets WHERE id=packet.id FOR UPDATE;
  IF FOUND THEN
    IF existing.user_id<>owner_id THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
    IF existing.delivery_version<>p_expected_version OR existing.delivery_status IN ('queued','submitting','submitted','skipped') THEN
      RAISE EXCEPTION 'Application changed; reload the stored status before saving' USING ERRCODE='40001';
    END IF;
    UPDATE public.application_packets SET status=packet.status,source_cv_text=packet.source_cv_text,
      tailored_cv_text=packet.tailored_cv_text,cover_letter=packet.cover_letter,screening_answers=packet.screening_answers,
      resume_version_label=packet.resume_version_label,matched_keywords=packet.matched_keywords,missing_keywords=packet.missing_keywords,
      match_score=packet.match_score,truth_approved=packet.truth_approved,materials_approved=packet.materials_approved,
      submission_approved=packet.submission_approved WHERE id=packet.id RETURNING * INTO packet;
  ELSE
    IF p_expected_version<>0 THEN RAISE EXCEPTION 'Application changed' USING ERRCODE='40001'; END IF;
    INSERT INTO public.application_packets(id,user_id,job_id,job_snapshot,status,source_cv_text,tailored_cv_text,
      cover_letter,screening_answers,resume_version_label,matched_keywords,missing_keywords,match_score,
      truth_approved,materials_approved,submission_approved,idempotency_key)
      VALUES(packet.id,owner_id,packet.job_id,packet.job_snapshot,packet.status,COALESCE(packet.source_cv_text,''),
        COALESCE(packet.tailored_cv_text,''),COALESCE(packet.cover_letter,''),COALESCE(packet.screening_answers,'[]'::jsonb),
        COALESCE(packet.resume_version_label,'CV'),COALESCE(packet.matched_keywords,'{}'),COALESCE(packet.missing_keywords,'{}'),
        COALESCE(packet.match_score,0),COALESCE(packet.truth_approved,false),COALESCE(packet.materials_approved,false),
        COALESCE(packet.submission_approved,false),packet.id::text) RETURNING * INTO packet;
  END IF;
  RETURN to_jsonb(packet);
END;
$$;
REVOKE ALL ON FUNCTION public.save_application_draft(jsonb,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_application_draft(jsonb,bigint) TO authenticated;

CREATE INDEX application_delivery_user_status_idx ON public.application_packets(user_id,delivery_status,updated_at DESC);
-- Publish INSERT/UPDATE only in the client, not DELETE payloads containing PII.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='application_packets') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.application_packets;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='application_events') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.application_events;
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.guard_application_delivery(),public.audit_application_delivery(),public.project_application_task_delivery() FROM PUBLIC,anon,authenticated;
COMMIT;
