/** Enable only after migration 023 has converted the database rate columns. */
export function decimalJobRatesEnabled(): boolean {
  return process.env.JOB_DECIMAL_RATES_ENABLED === "true";
}

/** Preserve the exact rate_raw text, but never send fractions to integer columns. */
export function jobRateStorageBounds(job: { rate_min: number | null; rate_max: number | null }) {
  const fractional = [job.rate_min, job.rate_max].some(value => value !== null && !Number.isInteger(value));
  return fractional && !decimalJobRatesEnabled()
    ? { rate_min: null, rate_max: null }
    : { rate_min: job.rate_min, rate_max: job.rate_max };
}
