/**
 * Lever fetcher.
 *
 * Endpoint: https://api.lever.co/v0/postings/{slug}?mode=json
 * Auth: none (public postings API).
 *
 * Response: an ARRAY of postings:
 *   { id, text (title), hostedUrl, applyUrl, createdAt (ms epoch),
 *     categories: { location, team, commitment }, workplaceType,
 *     descriptionPlain, additionalPlain, lists: [{text, content}],
 *     salaryRange?: { min, max, currency, interval }, country }
 *
 * Nice properties: descriptionPlain/additionalPlain are already plain text,
 * `commitment` often literally says "Contract", and salaryRange is
 * structured when present.
 */

import { HttpClient } from "./http-client";
import type { CompanyConfig, RawATSJob } from "./types";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string; // 'remote' | 'onsite' | 'hybrid' | 'unspecified'
  categories?: { location?: string; team?: string; commitment?: string };
  descriptionPlain?: string;
  additionalPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

export function mapLeverJob(job: LeverPosting, company: CompanyConfig): RawATSJob {
  const listText = (job.lists ?? [])
    .map((l) => `${l.text ?? ""}\n${l.content ?? ""}`)
    .join("\n");

  // Surface useful structured fields as text so the processing engine's
  // contract gate and remote detector can see them.
  const commitment = job.categories?.commitment ? `Commitment: ${job.categories.commitment}.` : "";
  const description = [commitment, job.descriptionPlain ?? "", listText, job.additionalPlain ?? ""]
    .filter(Boolean)
    .join("\n\n");

  const sr = job.salaryRange;
  const rawSalary =
    sr && (sr.min || sr.max)
      ? `${sr.currency ?? ""} ${sr.min ?? ""}-${sr.max ?? ""} ${sr.interval ?? ""}`.trim()
      : "";

  const locationParts = [job.categories?.location ?? "", job.country ?? ""].filter(Boolean);
  const workplace = job.workplaceType && job.workplaceType !== "unspecified" ? ` (${job.workplaceType})` : "";

  return {
    sourceDomain: "jobs.lever.co",
    sourceIdentifier: job.id,
    sourceType: "lever",
    title: job.text ?? "",
    companyName: company.name,
    description,
    location: `${locationParts.join(", ")}${workplace}`.trim(),
    rawSalary,
    applyUrl: job.hostedUrl ?? job.applyUrl ?? "",
    postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    rawPayload: job,
  };
}

export async function fetchLever(client: HttpClient, company: CompanyConfig): Promise<RawATSJob[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company.slug)}?mode=json`;
  const data = await client.getJson<LeverPosting[]>(url);
  if (!Array.isArray(data)) return [];
  return data.map((j) => mapLeverJob(j, company));
}
