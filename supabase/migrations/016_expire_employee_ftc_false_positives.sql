-- A fixed-term employee (FTC) is not automatically an IR35 contractor.
-- Earlier ingestion treated the words "fixed term" and "FTC" as sufficient
-- contract evidence, which admitted salaried FullTime ATS roles.
UPDATE public.jobs
SET expired_at = COALESCE(expired_at, NOW())
WHERE expired_at IS NULL
  AND (
    title ~* '\mFTC\M|fixed[ -]term'
    OR description ~* 'employment type:[[:space:]]*(FullTime|Full[ -]?Time|PartTime|Permanent|Employee)'
  )
  AND NOT (
    title ~* 'outside[[:space:]]*IR35|inside[[:space:]]*IR35|day[ -]?rate'
    OR description ~* 'outside[[:space:]]*IR35|inside[[:space:]]*IR35|day[ -]?rate|per[[:space:]]+day'
  );
