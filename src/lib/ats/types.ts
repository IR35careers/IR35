/**
 * Shared types for the job ingestion pipeline.
 *
 * RawATSJob is the normalized shape every ATS fetcher (Greenhouse, Lever,
 * Ashby, Workable, Personio) maps its API response into. The processing
 * engine (src/lib/processing/) consumes RawATSJob and produces ProcessedJob,
 * which maps 1:1 onto the `jobs` database table.
 */

export type ATSType = "greenhouse" | "lever" | "ashby" | "workable" | "personio";

export interface CompanyConfig {
  /** Display name, e.g. "Monzo" */
  name: string;
  /** Which ATS this company uses */
  type: ATSType;
  /** The company's slug on that ATS, e.g. "monzo" in boards-api.greenhouse.io/v1/boards/monzo/jobs */
  slug: string;
}

/** The normalized output of every ATS fetcher, before processing. */
export interface RawATSJob {
  /** e.g. "boards.greenhouse.io" — pairs with sourceIdentifier as the dedup key */
  sourceDomain: string;
  /** The ATS's own unique ID for this posting */
  sourceIdentifier: string;
  sourceType: ATSType;
  title: string;
  companyName: string;
  /** Plain text or HTML description (processing strips HTML) */
  description: string;
  /** Location string as the ATS reports it, e.g. "London, England" */
  location: string;
  /** Raw salary/rate string if the ATS exposes one, else empty */
  rawSalary: string;
  /** Direct link for a candidate to apply */
  applyUrl: string;
  /** ISO 8601 date the ATS reports the job was posted/updated, if available */
  postedAt: string | null;
  /** The full original API object, stored for debugging/reprocessing */
  rawPayload: unknown;
}

export type IR35Status = "inside" | "outside" | "unknown";
export type Confidence = "high" | "medium" | "low";
export type RemoteType = "remote" | "hybrid" | "onsite" | "unknown";
export type RateType = "daily" | "hourly" | "annual" | "unknown";

/** Fully processed job, field names matching the `jobs` table columns. */
export interface ProcessedJob {
  title: string;
  company_name: string;
  description: string;
  location: string;
  remote_type: RemoteType;
  ir35_status: IR35Status;
  ir35_confidence: Confidence;
  rate_min: number | null;
  rate_max: number | null;
  rate_currency: string | null;
  rate_type: RateType;
  rate_confidence: Confidence;
  rate_raw: string;
  skills: string[];
  apply_url: string;
  source_domain: string;
  source_identifier: string;
  source_type: string;
  posted_at: string | null;
  raw_payload: unknown;
}

export interface FetchResult {
  company: CompanyConfig;
  jobs: RawATSJob[];
  error: string | null;
}
