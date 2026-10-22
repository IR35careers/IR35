import { z } from "zod";

const job = z.object({
  id: z.uuid(), title: z.string(), company_name: z.string(), location: z.string(),
  remote_type: z.enum(["remote", "hybrid", "onsite", "unknown"]),
  ir35_status: z.enum(["inside", "outside", "unknown"]),
  ir35_confidence: z.enum(["high", "medium", "low"]),
  rate_min: z.number().nullable(), rate_max: z.number().nullable(),
  rate_currency: z.string().nullable(), rate_type: z.enum(["daily", "hourly", "annual", "unknown"]),
  skills: z.array(z.string()), posted_at: z.string().nullable(), first_seen_at: z.string(),
  last_seen_at: z.string().optional(), source_domain: z.string().optional(),
});

export const initialJobSearchSchema = z.object({
  jobs: z.array(job), total: z.number().int().nonnegative(),
  page: z.number().int().positive(), per_page: z.number().int().min(1).max(50),
  data_source: z.enum(["live", "demo"]).optional(), generated_at: z.string().optional(),
});
export type InitialJobSearch = z.infer<typeof initialJobSearchSchema>;

/** Same bounded public GET contract for SSR and interactive filtering. */
export function publicSearchParams(values: Record<string, string | string[] | undefined>): URLSearchParams {
  const result = new URLSearchParams();
  for (const key of ["q", "ir35", "remote", "min_rate", "seniority", "rate_type", "sponsorship", "location", "skills", "sort", "page", "within_days"]) {
    const value = values[key];
    if (typeof value === "string") result.set(key, value.slice(0, 500));
  }
  result.set("per_page", "12");
  return result;
}
