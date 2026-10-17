-- Preserve advertised pence (e.g. £35.98/hour) instead of rounding money.
-- Existing integer values convert exactly; no listings or applications are removed.
ALTER TABLE public.jobs
  ALTER COLUMN rate_min TYPE numeric(12,2) USING rate_min::numeric(12,2),
  ALTER COLUMN rate_max TYPE numeric(12,2) USING rate_max::numeric(12,2);
