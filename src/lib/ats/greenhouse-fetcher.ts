/**
 * Greenhouse fetcher.
 *
 * Endpoint: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 * Auth: none (public job boards API).
 *
 * Response shape:
 *   { jobs: [ { id, title, updated_at, absolute_url,
 *               location: { name }, content, metadata, ... } ] }
 *
 * `content` is HTML-entity-escaped HTML ("&lt;p&gt;...") — the processing
 * engine's stripHtml handles double-encoded content.
 */

import { HttpClient } from "./http-client";
import type { CompanyConfig, RawATSJob } from "./types";

interface GreenhouseJob {
  id: number;
  title: string;
  updated_at?: string;
  first_published?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  metadata?: unknown;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export function mapGreenhouseJob(job: GreenhouseJob, company: CompanyConfig): RawATSJob {
  return {
    sourceDomain: "boards.greenhouse.io",
    sourceIdentifier: String(job.id),
    sourceType: "greenhouse",
    title: job.title ?? "",
    companyName: company.name,
    description: job.content ?? "",
    location: job.location?.name ?? "",
    rawSalary: "",
    applyUrl: job.absolute_url ?? "",
    postedAt: job.first_published ?? job.updated_at ?? null,
    rawPayload: job,
  };
}

export async function fetchGreenhouse(
  client: HttpClient,
  company: CompanyConfig
): Promise<RawATSJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    company.slug
  )}/jobs?content=true`;
  const data = await client.getJson<GreenhouseResponse>(url);
  if (!Array.isArray(data?.jobs)) return [];
  return data.jobs.map((j) => mapGreenhouseJob(j, company));
}
