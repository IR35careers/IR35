-- =============================================================================
-- Maintenance 004 — one-off cleanup of pre-fix data (run once in SQL Editor)
--
-- 1. Clears the "£0" rates stored before the parser fix (they'll display as
--    "Rate on application"; the next pipeline run re-parses them properly).
-- 2. Expires non-professional temp roles (retail/care/warehouse/etc.) that
--    slipped in before the professional-role gate existed. Expired = hidden
--    from the board, not deleted.
-- =============================================================================

UPDATE jobs
SET rate_min = NULL,
    rate_max = NULL,
    rate_currency = NULL,
    rate_type = 'unknown',
    rate_confidence = 'low'
WHERE (rate_min = 0 OR rate_max = 0)
  AND expired_at IS NULL;

UPDATE jobs
SET expired_at = NOW()
WHERE expired_at IS NULL
  AND (
    title ~* '\m(colleague|shop assistant|store assistant|retail assistant|sales assistant|checkout|shelf stacker|warehouse (operative|assistant|worker)|delivery driver|courier|van driver|hgv|forklift|cleaner|cleaning operative|housekeep(er|ing)|janitor|barista|waiter|waitress|bartender|kitchen (porter|assistant|staff)|chef|catering assistant|care (assistant|worker)|support worker|healthcare assistant|nursery (nurse|assistant)|labourer|picker|packer|production operative|assembly operative|security (officer|guard)|door supervisor|steward|crew member)\M'
    OR (rate_type = 'hourly' AND rate_max IS NOT NULL AND rate_max < 18)
    OR (rate_type = 'daily' AND rate_max IS NOT NULL AND rate_max < 120)
  );

-- Report what's left:
SELECT COUNT(*) AS live_jobs FROM jobs WHERE expired_at IS NULL;
