/**
 * Workable fetcher.
 *
 * Endpoint: https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true
 * Auth: none (public widget API).
 *
 * Response shape:
 *   { name, jobs: [ { title, shortcode, url, application_url,
 *                     employment_type, telecommuting (bool),
 *                     city, state, country, published_on, created_at,
 *                     description (HTML, when details=true) } ] }
 */

import { HttpClient } from "./http-client";
import type { CompanyConfig, RawATSJob } from "./types";

interface WorkableJob {
  title: string;
  shortcode: string;
  url?: string;
  application_url?: string;
  employment_type?: string; // e.g. 'Full-time' | 'Contract'
  telecommuting?: boolean;
  city?: string;
  state?: string;
  country?: string;
  published_on?: string;
  created_at?: string;
  description?: string;
}

interface WorkableResponse {
  jobs: WorkableJob[];
}

export function mapWorkableJob(job: WorkableJob, company: CompanyConfig): RawATSJob {
  const employment = job.employment_type ? `Employment type: ${job.employment_type}.` : "";
  const description = [employment, job.description ?? ""].filter(Boolean).join("\n\n");

  const locationParts = [job.city, job.state, job.country].filter(Boolean);
  const remoteSuffix = job.telecommuting ? " (Remote)" : "";

  return {
    sourceDomain: "apply.workable.com",
    sourceIdentifier: job.shortcode,
    sourceType: "workable",
    title: job.title ?? "",
    companyName: company.name,
    description,
    location: `${locationParts.join(", ")}${remoteSuffix}`.trim(),
    rawSalary: "",
    applyUrl: job.url ?? job.application_url ?? "",
    postedAt: job.published_on ?? job.created_at ?? null,
    rawPayload: job,
  };
}

export async function fetchWorkable(
  client: HttpClient,
  company: CompanyConfig
): Promise<RawATSJob[]> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(
    company.slug
  )}?details=true`;
  const data = await client.getJson<WorkableResponse>(url);
  if (!Array.isArray(data?.jobs)) return [];
  return data.jobs.map((j) => mapWorkableJob(j, company));
}
