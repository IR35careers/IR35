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
import { findRateInText, parseRate, type ParsedRate } from "./rate-parser";
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

// ── Contract detection ───────────────────────────────────────────────────
// The word "contract" alone is NOT a reliable signal in descriptions —
// permanent jobs routinely say "employment contract", "your contract
// includes", "permanent contract". We split signals into title-level
// (high confidence) and description-level (must be contextual).

/** Strong signals: if ANY of these appear in the TITLE, it's a contract role. */
const TITLE_CONTRACT_SIGNALS =
  /\bcontract(?:or|ing)?\b|\binterim\b|\bfreelance\b|\bfixed[\s-]term\b|\bftc\b|\bir\s*-?\s*35\b|\boutside\s*ir35\b|\binside\s*ir35\b|\bday[\s-]*rate\b/i;

/**
 * Description-level signals: contextual phrases that indicate a contract
 * engagement, NOT the bare word "contract" (which appears in every
 * permanent job's legal boilerplate too).
 */
const DESC_CONTRACT_SIGNALS =
  /\bcontract\s+(?:role|position|opportunity|engagement|assignment|basis|duration|length)\b|\b(?:3|6|9|12|18|24)\s*[\s-]*month\s+(?:contract|engagement|assignment|extension)\b|\bday[\s-]*rate\b|\bper\s*day\b|\bp\/?d\b|\bdaily\s+rate\b|\bper\s*hour\b|\bfreelance\b|\binterim\b|\bfixed[\s-]term\b|\bftc\b|\bir\s*-?\s*35\b|\boutside\s*ir35\b|\binside\s*ir35\b|\binitial\s+(?:3|6|9|12|18|24)\s*[\s-]*month\b|\bcontract(?:or|ing)\s+(?:rate|pay|salary)\b|\brolling\s+contract\b|\b(?:via|through)\s+(?:an?\s+)?(?:umbrella|ltd|limited)\b/i;

/** Phrases that strongly indicate a permanent role, overriding weak signals. */
const PERMANENT_SIGNALS =
  /\bpermanent\s+(?:role|position|opportunity|contract)\b|\bfull[\s-]time\s+permanent\b|\bpermanent\s+(?:full|part)[\s-]time\b|\bpermanent\s+staff\b|\bsalaried\s+(?:role|position)\b/i;

/** ATS employment-type fields that definitively mark a role as contract. */
const EMPLOYMENT_TYPE_CONTRACT =
  /\bemployment\s+type:\s*contract\b/i;

export function isContractRole(title: string, description: string, rawSalary: string): boolean {
  const t = title ?? "";
  const d = description ?? "";
  const s = rawSalary ?? "";

  // 1. Title is the strongest signal — recruiters put "Contract" or
  //    "Outside IR35" in titles deliberately, never accidentally.
  if (TITLE_CONTRACT_SIGNALS.test(t)) return true;

  // 2. ATS employment-type field (surfaced by fetchers into description
  //    as "Employment type: Contract").
  if (EMPLOYMENT_TYPE_CONTRACT.test(d)) return true;

  // 3. Description-level contextual signals.
  const fullText = `${d} ${s}`;
  if (!DESC_CONTRACT_SIGNALS.test(fullText)) return false;

  // 4. If the description also has strong permanent wording AND no
  //    IR35/day-rate signal, it's probably a permanent role that
  //    happened to mention "6 month contract" in passing.
  if (PERMANENT_SIGNALS.test(fullText) && !/\bir\s*-?\s*35\b|\bday[\s-]*rate\b|\bper\s*day\b|\bp\/?d\b/i.test(fullText)) {
    return false;
  }

  return true;
}

/**
 * Professional-role gate. Reed/Adzuna's "contract" filters include retail,
 * care, and manual temp work ("Service Colleague", "Warehouse Operative") —
 * legitimate jobs, but not what a professional contractor board serves.
 * Filters on obvious title patterns plus a sub-professional rate floor.
 */
const NON_PROFESSIONAL_TITLES =
  /\b(colleague|shop\s+assistant|store\s+assistant|retail\s+assistant|sales\s+assistant|customer\s+(?:service|team)\s+(?:advisor|assistant|member)|checkout|shelf\s+stacker|warehouse\s+(?:operative|assistant|worker)|delivery\s+driver|courier|van\s+driver|hgv|forklift|cleaner|cleaning\s+operative|housekeep(?:er|ing)|janitor|barista|waiter|waitress|bartender|kitchen\s+(?:porter|assistant|staff)|chef\b|catering\s+assistant|care\s+(?:assistant|worker)|support\s+worker|healthcare\s+assistant|nursery\s+(?:nurse|assistant)|labourer|picker|packer|production\s+operative|assembly\s+operative|security\s+(?:officer|guard)|door\s+supervisor|steward|crew\s+member|shift\s+leader\b)/i;

export function isProfessionalRole(title: string, rate: ParsedRate): boolean {
  if (NON_PROFESSIONAL_TITLES.test(title ?? "")) return false;
  // Known rates far below professional contracting: hourly under £18 or a
  // day rate under £120 signal temp/casual work, not contracting.
  const basis = rate.max ?? rate.min;
  if (basis !== null) {
    if (rate.type === "hourly" && basis < 18) return false;
    if (rate.type === "daily" && basis < 120) return false;
  }
  return true;
}

/**
 * Process one raw ATS job. Returns null when the job should be skipped
 * (not a contract role, not UK-relevant, or not professional contracting).
 */
export function processRawJob(raw: RawATSJob): ProcessedJob | null {
  const title = cleanTitle(raw.title);
  const description = stripHtml(raw.description);

  if (!title || !raw.applyUrl) return null;

  // ── Gate 1: contract roles only ──────────────────────────────────────
  // Sources that pre-filter at the API level (Reed/Adzuna with contract-only
  // queries) set contractHint and bypass text heuristics entirely.
  if (raw.contractHint === false) return null;
  if (raw.contractHint !== true && !isContractRole(title, description, raw.rawSalary ?? "")) {
    return null;
  }

  // ── Rate: structured field first, description fallback second ────────
  let rate = parseRate(raw.rawSalary);
  if (rate.min === null && rate.max === null) {
    rate = findRateInText(description);
  }

  // ── Gate 1b: professional roles only ─────────────────────────────────
  if (!isProfessionalRole(title, rate)) return null;

  // ── IR35 ─────────────────────────────────────────────────────────────
  const ir35 = classifyIR35(title, description);

  // ── Location + UK gate ───────────────────────────────────────────────
  // Sources that are UK-only by construction (ukHint) skip the gate; their
  // locations still get normalized for consistent display.
  const loc = normalizeLocation(raw.location);
  if (raw.ukHint !== true) {
    const ukMarketSignal = rate.currency === "GBP" || ir35.status !== "unknown";
    const isBareRemote = loc.location === "Remote";
    const ukAccepted = loc.isUK && (!isBareRemote || ukMarketSignal);
    if (!ukAccepted) return null;
  }

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
