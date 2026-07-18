/**
 * Ashby fetcher.
 *
 * Endpoint: https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 * Auth: none (public job board API).
 *
 * Response shape:
 *   { jobs: [ { id, title, location, secondaryLocations, isRemote, isListed,
 *               employmentType, publishedAt, jobUrl, applyUrl,
 *               descriptionHtml, descriptionPlain,
 *               compensation?: { compensationTierSummary?, ... } } ] }
 */

import { HttpClient } from "./http-client";
import type { CompanyConfig, RawATSJob } from "./types";

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  isRemote?: boolean;
  isListed?: boolean;
  employmentType?: string; // e.g. 'FullTime' | 'Contract' | 'Intern'
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: { compensationTierSummary?: string };
}

interface AshbyResponse {
  jobs: AshbyJob[];
}

export function mapAshbyJob(job: AshbyJob, company: CompanyConfig): RawATSJob {
  // Surface employmentType as text — "Contract" here is a strong signal for
  // the processing engine's contract gate.
  const employment = job.employmentType ? `Employment type: ${job.employmentType}.` : "";
  const description = [employment, job.descriptionPlain ?? job.descriptionHtml ?? ""]
    .filter(Boolean)
    .join("\n\n");

  const remoteSuffix = job.isRemote ? " (Remote)" : "";

  return {
    sourceDomain: "jobs.ashbyhq.com",
    sourceIdentifier: job.id,
    sourceType: "ashby",
    title: job.title ?? "",
    companyName: company.name,
    description,
    location: `${job.location ?? ""}${remoteSuffix}`.trim(),
    rawSalary: job.compensation?.compensationTierSummary ?? "",
    applyUrl: job.jobUrl ?? job.applyUrl ?? "",
    postedAt: job.publishedAt ?? null,
    rawPayload: job,
  };
}

export async function fetchAshby(client: HttpClient, company: CompanyConfig): Promise<RawATSJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
    company.slug
  )}?includeCompensation=true`;
  const data = await client.getJson<AshbyResponse>(url);
  if (!Array.isArray(data?.jobs)) return [];
  return data.jobs.filter((j) => j.isListed !== false).map((j) => mapAshbyJob(j, company));
}
