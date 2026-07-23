/** Shape of a job row as returned by the public search API and detail pages. */
export interface JobListing {
  id: string;
  title: string;
  company_name: string;
  location: string;
  remote_type: "remote" | "hybrid" | "onsite" | "unknown";
  ir35_status: "inside" | "outside" | "unknown";
  ir35_confidence: "high" | "medium" | "low";
  rate_min: number | null;
  rate_max: number | null;
  rate_currency: string | null;
  rate_type: "daily" | "hourly" | "annual" | "unknown";
  skills: string[];
  posted_at: string | null;
  first_seen_at: string;
}

export interface JobDetail extends JobListing {
  description: string;
  apply_url: string;
  source_domain: string;
}

/** Columns fetched for list views — keep in sync with JobListing. */
export const JOB_LIST_COLUMNS =
  "id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at";

/** Human-friendly rate string: "£550-£650/day", "£85k/yr", "Rate on application". */
export function formatRate(job: Pick<JobListing, "rate_min" | "rate_max" | "rate_currency" | "rate_type">): string {
  const { rate_min: min, rate_max: max, rate_type: type } = job;
  if (min === null && max === null) return "Rate on application";
  const symbol = job.rate_currency === "USD" ? "$" : job.rate_currency === "EUR" ? "€" : "£";
  const fmt = (n: number) =>
    type === "annual" && n >= 1000 ? `${symbol}${Math.round(n / 1000)}k` : `${symbol}${n.toLocaleString()}`;
  const suffix = type === "daily" ? "/day" : type === "hourly" ? "/hr" : type === "annual" ? "/yr" : "";
  if (min !== null && max !== null && min !== max) return `${fmt(min)}-${fmt(max)}${suffix}`;
  const single = (max ?? min) as number;
  const prefix = min === null && max !== null ? "Up to " : "";
  return `${prefix}${fmt(single)}${suffix}`;
}

/** "Today", "3 days ago", "2 weeks ago" from the best available date. */
export function formatPosted(job: Pick<JobListing, "posted_at" | "first_seen_at">): string {
  const iso = job.posted_at ?? job.first_seen_at;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
}
