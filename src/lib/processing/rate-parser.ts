/**
 * Rate Parser
 *
 * Converts the messy spectrum of UK contractor rate strings into structured
 * numbers. Examples it handles:
 *
 *   "£550/day"              → min 550,  max 550,  GBP, daily,  high
 *   "£550 - £650 per day"   → min 550,  max 650,  GBP, daily,  high
 *   "Up to £700 p/d"        → min null, max 700,  GBP, daily,  medium
 *   "From £400 a day"       → min 400,  max null, GBP, daily,  medium
 *   "circa £600/day"        → min 540,  max 660,  GBP, daily,  medium
 *   "£65 per hour"          → min 65,   max 65,   GBP, hourly, high
 *   "£85k per annum"        → min 85000,max 85000,GBP, annual, high
 *   "Competitive" / "DOE"   → all null, unknown, low
 *
 * Design choice: unknown bounds are `null`, never 0 — 0 is a real number and
 * poisons range filters ("min rate £400" must not match an "up to £700" job
 * whose min was stored as 0... it legitimately might pay £400+, which is why
 * open bounds stay null and filtering treats null as "unbounded").
 */

import type { Confidence, RateType } from "../ats/types";

export interface ParsedRate {
  min: number | null;
  max: number | null;
  currency: string | null;
  type: RateType;
  confidence: Confidence;
  raw: string;
}

const EMPTY = (raw: string): ParsedRate => ({
  min: null,
  max: null,
  currency: null,
  type: "unknown",
  confidence: "low",
  raw,
});

/** Detect the pay period from surrounding words. */
function detectType(text: string): RateType {
  if (/\b(per[\s-]*day|a\s*day|day[\s-]*rate|daily|\/\s*day|p\/?d\b|pd\b)/i.test(text)) return "daily";
  if (/\b(per[\s-]*hour|an\s*hour|hourly|\/\s*h(ou)?r|p\/?h\b|ph\b)/i.test(text)) return "hourly";
  if (/\b(per[\s-]*annum|annual(ly)?|a\s*year|per[\s-]*year|\/\s*year|p\.?a\.?\b|salary)/i.test(text)) return "annual";
  return "unknown";
}

function detectCurrency(text: string): string | null {
  if (text.includes("£") || /\bgbp\b/i.test(text)) return "GBP";
  if (text.includes("$") || /\busd\b/i.test(text)) return "USD";
  if (text.includes("€") || /\beur\b/i.test(text)) return "EUR";
  return null;
}

/** Parse a single numeric token, handling "550", "1,200", "85k", "85.5k". */
function parseAmount(token: string): number | null {
  const cleaned = token.replace(/,/g, "").trim();
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  // £0 means "unspecified", never a real rate.
  return rounded > 0 ? rounded : null;
}

/**
 * If no explicit period was found, infer one from the magnitude of the
 * amounts. UK contract context: 150–3,000 reads as a day rate; 20,000+ reads
 * as an annual salary; under 150 reads as hourly. Anything inferred this way
 * is capped at low confidence.
 */
function inferTypeFromMagnitude(amount: number): RateType {
  if (amount >= 20000) return "annual";
  if (amount >= 150 && amount <= 3000) return "daily";
  if (amount > 0 && amount < 150) return "hourly";
  return "unknown";
}

// Number token: digits with optional commas/decimal, optional "k" suffix.
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?\s*k?)`;

const RANGE_RE = new RegExp(String.raw`${NUM}\s*(?:-|–|—|to)\s*[£$€]?\s*${NUM}`, "i");
const UP_TO_RE = new RegExp(String.raw`(?:up\s*to|max(?:imum)?\s*(?:of)?)\s*[£$€]?\s*${NUM}`, "i");
const FROM_RE = new RegExp(String.raw`(?:from|min(?:imum)?\s*(?:of)?|starting\s*(?:at|from))\s*[£$€]?\s*${NUM}`, "i");
const CIRCA_RE = new RegExp(String.raw`(?:circa|c\.|approx(?:imately)?|around|about|~)\s*[£$€]?\s*${NUM}`, "i");
const SINGLE_RE = new RegExp(String.raw`[£$€]\s*${NUM}`, "i");
const BARE_NUM_RE = new RegExp(String.raw`\b${NUM}\b`, "i");

export function parseRate(input: string | null | undefined): ParsedRate {
  const raw = (input ?? "").trim();
  if (!raw) return EMPTY(raw);

  // Pure "no useful number" strings.
  if (/^(competitive|negotiable|doe|market\s*rate|attractive|excellent)[\s.!]*$/i.test(raw)) {
    return EMPTY(raw);
  }

  const currency = detectCurrency(raw);
  let type = detectType(raw);

  let min: number | null = null;
  let max: number | null = null;
  let confidence: Confidence = "low";

  const range = raw.match(RANGE_RE);
  const upTo = raw.match(UP_TO_RE);
  const from = raw.match(FROM_RE);
  const circa = raw.match(CIRCA_RE);

  if (range) {
    min = parseAmount(range[1]);
    max = parseAmount(range[2]);
    // "£550-650": the shorthand upper bound inherits the lower bound's scale.
    if (min !== null && max !== null && max < min) {
      if (min >= 1000 && max < 1000) {
        // e.g. "£1,200-950" is garbage; but "£550-650" never hits this branch.
        // Swap as a last resort.
        [min, max] = [max, min];
      } else {
        [min, max] = [max, min];
      }
    }
    confidence = "high";
  } else if (upTo) {
    max = parseAmount(upTo[1]);
    confidence = "medium";
  } else if (from) {
    min = parseAmount(from[1]);
    confidence = "medium";
  } else if (circa) {
    const mid = parseAmount(circa[1]);
    if (mid !== null) {
      min = Math.round(mid * 0.9);
      max = Math.round(mid * 1.1);
      confidence = "medium";
    }
  } else {
    const single = raw.match(SINGLE_RE) ?? (currency ? null : raw.match(BARE_NUM_RE));
    if (single) {
      const amount = parseAmount(single[1]);
      if (amount !== null) {
        min = amount;
        max = amount;
        confidence = currency && type !== "unknown" ? "high" : "medium";
      }
    }
  }

  if (min === null && max === null) return EMPTY(raw);

  // Infer period from magnitude when the text never said.
  if (type === "unknown") {
    const basis = max ?? min;
    if (basis !== null) {
      type = inferTypeFromMagnitude(basis);
      confidence = "low";
    }
  }

  // ── Correct implausible classifications ──────────────────────────────
  // A "daily" rate above £5,000 is almost always an annual salary that was
  // mislabelled (e.g. Adzuna annualises, or a description mixed figures).
  // Reclassify by magnitude rather than showing "£93,000/day".
  {
    const basis0 = max ?? min;
    if (basis0 !== null) {
      if (type === "daily" && basis0 > 5000) {
        type = basis0 >= 20000 ? "annual" : "daily";
        if (type === "annual") confidence = "low";
      }
      if (type === "hourly" && basis0 > 500) {
        type = basis0 >= 20000 ? "annual" : basis0 >= 150 ? "daily" : "hourly";
        confidence = "low";
      }
    }
  }

  // Sanity bounds per period — genuinely out-of-band numbers are dropped
  // entirely (better "Rate on application" than a wrong figure).
  const basis = max ?? min ?? 0;
  const outOfBounds =
    (type === "daily" && (basis < 80 || basis > 5000)) ||
    (type === "hourly" && (basis < 8 || basis > 500)) ||
    (type === "annual" && (basis < 12000 || basis > 750000));
  if (outOfBounds) {
    return { min: null, max: null, currency, type: "unknown", confidence: "low", raw };
  }

  return {
    min,
    max,
    // A bare number with a detected UK period ("550 per day") is near-certainly GBP.
    currency: currency ?? (type === "daily" || type === "hourly" ? "GBP" : null),
    type,
    confidence,
    raw,
  };
}

/**
 * Fallback: scan a job description for a rate mention when the ATS gave no
 * structured salary field. Only trusts sentences that contain both a currency
 * symbol and a period keyword, to avoid picking up random numbers.
 */
export function findRateInText(description: string): ParsedRate {
  const text = description ?? "";
  const sentenceRe =
    /[^.\n]*[£$€][^.\n]{0,80}?(?:per\s*day|a\s*day|day\s*rate|daily|\/\s*day|p\/?d\b|per\s*hour|hourly|p\/?h\b|per\s*annum)[^.\n]*/gi;
  const candidates = text.match(sentenceRe);
  if (!candidates) return EMPTY("");
  // Parse the first plausible sentence.
  for (const sentence of candidates) {
    const parsed = parseRate(sentence);
    if (parsed.min !== null || parsed.max !== null) {
      return { ...parsed, confidence: parsed.confidence === "high" ? "medium" : "low" };
    }
  }
  return EMPTY("");
}
