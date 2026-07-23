-- Maintenance 008 — fix implausible day rates already stored (e.g.
-- "£93,000/day", which is a mislabelled annual salary). Run once.
-- Reclassify big "daily" values as annual; drop truly out-of-bounds ones.

-- Daily values >= £20,000 are annual salaries mislabelled as day rates.
UPDATE jobs
SET rate_type = 'annual'
WHERE expired_at IS NULL AND rate_type = 'daily'
  AND COALESCE(rate_max, rate_min) >= 20000;

-- Daily values £5,001–£19,999 are implausible; clear the rate.
UPDATE jobs
SET rate_min = NULL, rate_max = NULL, rate_type = 'unknown', rate_confidence = 'low'
WHERE expired_at IS NULL AND rate_type = 'daily'
  AND COALESCE(rate_max, rate_min) > 5000
  AND COALESCE(rate_max, rate_min) < 20000;

-- Hourly values > £500 are implausible; clear.
UPDATE jobs
SET rate_min = NULL, rate_max = NULL, rate_type = 'unknown', rate_confidence = 'low'
WHERE expired_at IS NULL AND rate_type = 'hourly'
  AND COALESCE(rate_max, rate_min) > 500;

SELECT COUNT(*) AS live_jobs FROM jobs WHERE expired_at IS NULL;
