/**
 * SmartRecruiters public Posting API fetcher.
 *
 * List:   https://api.smartrecruiters.com/v1/companies/{slug}/postings
 * Detail: https://api.smartrecruiters.com/v1/companies/{slug}/postings/{id}
 * Auth: none for postings already published on a public careers page.
 *
 * Detail requests are limited to recent UK postings with an explicit
 * contract signal. This avoids downloading permanent vacancies and filters
 * legacy boards that still expose years-old postings as active.
 */

import { HttpClient } from "./http-client";
import type { CompanyConfig, RawATSJob } from "./types";

interface SmartRecruitersLocation {
  city?: string;
  region?: string;
  country?: string;
  fullLocation?: string;
  remote?: boolean;
  hybrid?: boolean;
}

interface SmartRecruitersEmploymentType {
  id?: string;
  label?: string;
}

interface SmartRecruitersSection {
  title?: string;
  text?: string;
}

export interface SmartRecruitersPosting {
  id: string;
  uuid?: string;
  name?: string;
  releasedDate?: string;
  postingUrl?: string;
  applyUrl?: string;
  location?: SmartRecruitersLocation;
  typeOfEmployment?: SmartRecruitersEmploymentType;
  customField?: Array<{ fieldLabel?: string; valueLabel?: string }>;
  jobAd?: { sections?: Record<string, SmartRecruitersSection> };
}

interface SmartRecruitersListResponse {
  offset?: number;
  limit?: number;
  totalFound?: number;
  content?: SmartRecruitersPosting[];
}

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const DETAIL_CONCURRENCY = 8;
const MAX_POSTING_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const CONTRACT_SIGNAL = /\b(?:contract(?:or|ing)?|freelance|interim|temporary|day[ -]?rate|fixed[ -]?term|locum|ir\s*-?\s*35)\b/i;
const PERMANENT_EMPLOYMENT = /\b(?:permanent|full[ -]?time|part[ -]?time)\b/i;
const CONTRACTOR_EVIDENCE = /\b(?:ir\s*-?\s*35|day[ -]?rate|per\s+(?:day|hour)|freelance|sub[ -]?contractor)\b/i;

function hasContractSignal(posting: SmartRecruitersPosting): boolean {
  const customFields = (posting.customField ?? [])
    // A field named "Contract type" occurs on permanent roles too. Only
    // its VALUE is evidence of a contract engagement.
    .map((field) => field.valueLabel ?? "")
    .join(" ");
  const employment = `${posting.typeOfEmployment?.id ?? ""} ${posting.typeOfEmployment?.label ?? ""}`;
  if (PERMANENT_EMPLOYMENT.test(employment)) {
    return CONTRACTOR_EVIDENCE.test(`${posting.name ?? ""} ${customFields}`)
      || /\bcontract(?:or)?\b|\binterim\b|\bfreelance\b/i.test(posting.name ?? "");
  }
  return CONTRACT_SIGNAL.test(`${posting.name ?? ""} ${employment} ${customFields}`);
}

function isUkPosting(posting: SmartRecruitersPosting): boolean {
  const country = (posting.location?.country ?? "").trim().toLowerCase();
  const fullLocation = posting.location?.fullLocation ?? "";
  return country === "gb" || country === "uk" || /\b(?:united kingdom|england|scotland|wales|northern ireland)\b/i.test(fullLocation);
}

function isRecentPosting(posting: SmartRecruitersPosting, now = Date.now()): boolean {
  if (!posting.releasedDate) return true;
  const released = Date.parse(posting.releasedDate);
  return Number.isNaN(released) || now - released <= MAX_POSTING_AGE_MS;
}

export function mapSmartRecruitersJob(
  job: SmartRecruitersPosting,
  company: CompanyConfig
): RawATSJob {
  const sections = Object.values(job.jobAd?.sections ?? {});
  const description = [
    job.typeOfEmployment?.label ? `Employment type: ${job.typeOfEmployment.label}.` : "",
    ...sections.map((section) => [section.title, section.text].filter(Boolean).join("\n")),
  ].filter(Boolean).join("\n\n");
  const location = job.location?.fullLocation || [
    job.location?.city,
    job.location?.region,
    job.location?.country,
  ].filter(Boolean).join(", ");
  const workplace = job.location?.remote ? "Remote" : job.location?.hybrid ? "Hybrid" : "";
  const employment = `${job.typeOfEmployment?.id ?? ""} ${job.typeOfEmployment?.label ?? ""}`;
  const explicitContract = /\bcontract\b/i.test(employment) && !PERMANENT_EMPLOYMENT.test(employment);
  const roleEvidence = `${job.name ?? ""} ${description}`;

  return {
    sourceDomain: "jobs.smartrecruiters.com",
    sourceIdentifier: String(job.id),
    sourceType: "smartrecruiters",
    title: job.name ?? "",
    companyName: company.name,
    description,
    location: [location, workplace].filter(Boolean).join(" · "),
    rawSalary: "",
    applyUrl: job.applyUrl ?? job.postingUrl ?? "",
    postedAt: job.releasedDate ?? null,
    rawPayload: job,
    // Full-time Contract Managers are employees; do not let a title or a
    // custom field label bypass the processor's employment gate. Some
    // advertisers label genuine day-rate work Full-time, so retain explicit
    // IR35/rate evidence and let the processor assess it normally.
    contractHint: explicitContract ? true
      : PERMANENT_EMPLOYMENT.test(employment) && !CONTRACTOR_EVIDENCE.test(roleEvidence) ? false
        : undefined,
    ukHint: isUkPosting(job),
  };
}

export async function fetchSmartRecruiters(
  client: HttpClient,
  company: CompanyConfig,
  deadlineMs = Number.POSITIVE_INFINITY
): Promise<RawATSJob[]> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.slug)}/postings`;
  const summaries: SmartRecruitersPosting[] = [];
  let totalFound = Number.POSITIVE_INFINITY;

  for (let page = 0; page < MAX_PAGES && summaries.length < totalFound; page++) {
    if (Date.now() >= deadlineMs) break;
    const offset = page * PAGE_SIZE;
    const data = await client.getJson<SmartRecruitersListResponse>(
      `${base}?limit=${PAGE_SIZE}&offset=${offset}&country=gb`
    );
    const rows = Array.isArray(data?.content) ? data.content : [];
    totalFound = typeof data?.totalFound === "number" ? data.totalFound : summaries.length + rows.length;
    summaries.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const candidates = summaries.filter((posting) =>
    isUkPosting(posting) && isRecentPosting(posting) && hasContractSignal(posting)
  );
  const detailed: SmartRecruitersPosting[] = [];
  for (let index = 0; index < candidates.length; index += DETAIL_CONCURRENCY) {
    if (Date.now() >= deadlineMs) break;
    const chunk = candidates.slice(index, index + DETAIL_CONCURRENCY);
    const rows = await Promise.allSettled(chunk.map(async (summary) => {
      const detail = await client.getJson<SmartRecruitersPosting>(`${base}/${encodeURIComponent(summary.id)}`);
      return { ...summary, ...detail,
        location: detail.location ?? summary.location,
        typeOfEmployment: detail.typeOfEmployment ?? summary.typeOfEmployment,
        customField: detail.customField ?? summary.customField };
    }));
    // A withdrawn posting's 404 must not discard all other live vacancies.
    for (const row of rows) if (row.status === "fulfilled") detailed.push(row.value);
  }

  return detailed.map((posting) => mapSmartRecruitersJob(posting, company));
}
