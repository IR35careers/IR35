-- Deliberately no candidate names, email addresses, CVs, answers or tokens.
-- Run with `supabase db query --project-ref ... --file ...` (Management API).
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'application_id',p.id,'job_id',p.job_id,
  'is_requested_test_account',u.email='anvesh.mannuru+ir35test@gmail.com',
  'packet_status',p.status,'packet_updated_at',p.updated_at,
  'has_confirmation_receipt',COALESCE(p.receipt->>'receiptId','')<>'',
  'all_approvals',p.truth_approved AND p.materials_approved AND p.submission_approved,
  'events',(SELECT jsonb_agg(jsonb_build_object('at',e.created_at,'type',e.event_type,'label',e.label,
    'action',e.metadata->>'action','failure_reason',e.metadata->>'failure_reason') ORDER BY e.created_at)
    FROM public.application_events e WHERE e.application_id=p.id),
  'submissions',(SELECT jsonb_agg(jsonb_build_object('status',s.status,'error_code',s.error_code,
    'created_at',s.created_at,'updated_at',s.updated_at,'submitted_at',s.submitted_at,
    'action',s.receipt->>'action')) FROM public.application_submissions s WHERE s.application_id=p.id),
  'tasks',(SELECT jsonb_agg(jsonb_build_object('status',t.status,'attempts',t.attempts,
    'created_at',t.created_at,'updated_at',t.updated_at,'completed_at',t.completed_at,
    'destination_host',substring(t.destination FROM '^https://([^/]+)')))
    FROM public.application_worker_tasks t WHERE t.application_id=p.id)
) AS incident_evidence
FROM public.application_packets p JOIN auth.users u ON u.id=p.user_id
WHERE p.id='ba6c2abb-5c75-4a93-a9f9-dbc70f8189ac'
  AND p.job_id='7d8d7d76-72f9-4245-8112-b43a1ae5b797';
ROLLBACK;
