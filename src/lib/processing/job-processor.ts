/**
 * Job Processor — the pipeline orchestrator.
 *
 * RawATSJob in → ProcessedJob out (or null, meaning "skip this job").
 *
 * A job is skipped when it fails either gate:
 *   1. Contract gate — permanent/salaried roles are dropped; this is a
 *      contract-only board. Signals: contract/interim/freelance/fixed-term
 *      wording, day/hour rate wording, or any IR35 mention.
 *   2. UK gate — non-UK roles are dropped. A bare "Remote" with no country
 *      is accepted only when a UK-market signal exists (GBP day rate or an
 *      IR35 mention — IR35 is UK legislation, nobody else uses the term).
 */

import type { ProcessedJob, RawATSJob } from "../ats/types";
import { classifyIR35 } from "./ir35-classifier";
import { detectRemoteType, normalizeLocation } from "./location-normalizer";
import { findRateInText, parseRate } from "./rate-parser";
import { extractSkills } from "./skills-extractor";

/** Decode the handful of HTML entities ATS descriptions use. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&pound;/gi, "£")
    .replace(/&amp;/gi, "&");
}

/**
 * Strip HTML tags and decode entities. Runs the entity decode BOTH before
 * and after tag stripping: Greenhouse's boards API returns double-encoded
 * content ("&lt;p&gt;...") where the tags themselves only appear after a
 * first decode pass.
 */
export function stripHtml(html: string): string {
  return decodeEntities(html ?? "")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove spammy recruiter prefixes and collapse whitespace in titles. */
export function cleanTitle(title: string): string {
  return (title ?? "")
    .replace(/^\s*(?:\*+\s*)?(?:urgent|new|hot|asap)\s*[:!\-–—]*\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const CONTRACT_SIGNALS =
  /\bcontract(?:or|ing)?\b|\bday\s*rate\b|\bper\s*day\b|\bp\/?d\b|\binterim\b|\bfreelance\b|\bfixed[\s-]term\b|\bftc\b|\bir\s*-?\s*35\b|\b(?:3|6|9|12|18|24)\s*[\s-]*month\s+(?:contract|engagement|assignment)\b|\bdaily\s+rate\b|\boutside\s*ir35\b|\binside\s*ir35\b/i;

const PERMANENT_ONLY_SIGNALS = /\bpermanent\s+(?:role|position|opportunity)\b|\bfull[\s-]time\s+permanent\b/i;

export function isContractRole(title: string, description: string, rawSalary: string): boolean {
  const text = `${title} ${description} ${rawSalary}`;
  if (!CONTRACT_SIGNALS.test(text)) return false;
  // "Permanent" wording alongside no contract-specific rate → still allow if
  // an explicit contract signal exists (some ads say "perm or contract");
  // only a permanent-only ad with a coincidental keyword should be blocked,
  // which the CONTRACT_SIGNALS gate above already mostly prevents.
  if (PERMANENT_ONLY_SIGNALS.test(text) && !/\bcontract\b|\bir\s*-?\s*35\b|\bday\s*rate\b/i.test(text)) {
    return false;
  }
  return true;
}

/**
 * Process one raw ATS job. Returns null when the job should be skipped
 * (not a contract role, or not UK-relevant).
 */
export function processRawJob(raw: RawATSJob): ProcessedJob | null {
  const title = cleanTitle(raw.title);
  const description = stripHtml(raw.description);

  if (!title || !raw.applyUrl) return null;

  // ── Gate 1: contract roles only ──────────────────────────────────────
  if (!isContractRole(title, description, raw.rawSalary ?? "")) return null;

  // ── Rate: structured field first, description fallback second ────────
  let rate = parseRate(raw.rawSalary);
  if (rate.min === null && rate.max === null) {
    rate = findRateInText(description);
  }

  // ── IR35 ─────────────────────────────────────────────────────────────
  const ir35 = classifyIR35(title, description);

  // ── Location + UK gate ───────────────────────────────────────────────
  const loc = normalizeLocation(raw.location);
  const ukMarketSignal = rate.currency === "GBP" || ir35.status !== "unknown";
  const isBareRemote = loc.location === "Remote";
  const ukAccepted = loc.isUK && (!isBareRemote || ukMarketSignal);
  if (!ukAccepted) return null;

  // ── Remote type ──────────────────────────────────────────────────────
  const remote_type = detectRemoteType(raw.location, description);

  // ── Skills ───────────────────────────────────────────────────────────
  const skills = extractSkills(title, description);

  return {
    title,
    company_name: (raw.companyName ?? "").trim() || "Unknown",
    description,
    location: loc.location,
    remote_type,
    ir35_status: ir35.status,
    ir35_confidence: ir35.confidence,
    rate_min: rate.min,
    rate_max: rate.max,
    rate_currency: rate.currency,
    rate_type: rate.type,
    rate_confidence: rate.confidence,
    rate_raw: rate.raw,
    skills,
    apply_url: raw.applyUrl,
    source_domain: raw.sourceDomain,
    source_identifier: raw.sourceIdentifier,
    source_type: raw.sourceType,
    posted_at: raw.postedAt,
    raw_payload: raw.rawPayload,
  };
}
