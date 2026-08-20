-- Migration 012 — preserve advanced public-search filters in saved alerts.
-- Additive and backwards compatible with the existing alert UI and RLS policy.

ALTER TABLE IF EXISTS public.job_alerts
  ADD COLUMN IF NOT EXISTS seniority TEXT,
  ADD COLUMN IF NOT EXISTS rate_type TEXT,
  ADD COLUMN IF NOT EXISTS sponsorship TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_alerts_seniority_check') THEN
    ALTER TABLE public.job_alerts
      ADD CONSTRAINT job_alerts_seniority_check
      CHECK (seniority IS NULL OR seniority IN ('entry', 'senior', 'lead', 'manager'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_alerts_rate_type_check') THEN
    ALTER TABLE public.job_alerts
      ADD CONSTRAINT job_alerts_rate_type_check
      CHECK (rate_type IS NULL OR rate_type IN ('daily', 'hourly', 'annual'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_alerts_sponsorship_check') THEN
    ALTER TABLE public.job_alerts
      ADD CONSTRAINT job_alerts_sponsorship_check
      CHECK (sponsorship IS NULL OR sponsorship = 'stated');
  END IF;
END $$;
