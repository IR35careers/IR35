/**
 * IR35 Classifier
 *
 * Strict, explicit-mention-only classification. This never infers status from
 * vibes — a wrong "Outside IR35" label is a trust killer (and a real tax risk
 * for the contractor), so anything without an explicit signal is `unknown`.
 *
 * Confidence:
 *   high   — explicit mention in the job title
 *   medium — explicit mention in the description, or a near-explicit
 *            arrangement signal ("umbrella only", "PAYE only" → inside)
 *   low    — no signal found (status: unknown), or conflicting signals
 */

import type { Confidence, IR35Status } from "../ats/types";

export interface IR35Classification {
  status: IR35Status;
  confidence: Confidence;
}

export type IR35EvidenceBasis =
  | "advertiser_title"
  | "advertiser_listing"
  | "arrangement_inference"
  | "conflict"
  | "not_found";

export interface IR35ClassificationEvidence extends IR35Classification {
  basis: IR35EvidenceBasis;
  evidence: string | null;
}

// "outside ir35", "outside of ir-35", "ir35: outside", "determination: outside",
// "deemed outside", "outside ir35 contract" ...
const OUTSIDE_PATTERNS = [
  /\boutside\s*(?:of\s*)?ir\s*-?\s*35\b/i,
  /\bir\s*-?\s*35\s*(?:status)?\s*[:\-–]\s*outside\b/i,
  /\bir\s*-?\s*35\s*determination\s*[:\-–]?\s*outside\b/i,
  /\bdeemed\s+outside\s+(?:of\s+)?ir\s*-?\s*35\b/i,
  /\bdetermined\s+(?:as\s+)?outside\b[^.]{0,30}\bir\s*-?\s*35\b/i,
  /\boutside\s*-\s*ir35\b/i,
  /\boutside\s+(?:the\s+)?scope\s+of\s+ir\s*-?\s*35\b/i,
  /\bir\s*-?\s*35\s+(?:exempt|does\s+not\s+apply)\b/i,
  /\bnot\s+(?:caught|inside)\s+(?:by\s+)?ir\s*-?\s*35\b/i,
  /\b(?:sds|status\s+determination(?:\s+statement)?)\s*[:\-–]?\s*outside\b/i,
];

const INSIDE_PATTERNS = [
  /\binside\s*(?:of\s*)?ir\s*-?\s*35\b/i,
  /\bir\s*-?\s*35\s*(?:status)?\s*[:\-–]\s*inside\b/i,
  /\bir\s*-?\s*35\s*determination\s*[:\-–]?\s*inside\b/i,
  /\bdeemed\s+inside\s+(?:of\s+)?ir\s*-?\s*35\b/i,
  /\bdetermined\s+(?:as\s+)?inside\b[^.]{0,30}\bir\s*-?\s*35\b/i,
  /\binside\s*-\s*ir35\b/i,
  /\bwithin\s+(?:the\s+)?scope\s+of\s+ir\s*-?\s*35\b/i,
  /\bir\s*-?\s*35\s+applies\b/i,
  /(?<!not\s)caught\s+by\s+ir\s*-?\s*35\b/i,
  /\b(?:sds|status\s+determination(?:\s+statement)?)\s*[:\-–]?\s*inside\b/i,
];

// Near-explicit "inside" arrangements: umbrella-only / PAYE-only engagements
// are inside IR35 by construction. Kept separate so they never override an
// explicit "outside" mention and only ever earn medium confidence.
const INSIDE_ARRANGEMENT_PATTERNS = [
  /\b(?:via|through)\s+(?:an?\s+)?umbrella(?:\s+company)?\s+only\b/i,
  /\bumbrella\s+(?:company\s+)?only\b/i,
  /\bpaye\s+only\b/i,
  /\bpaye\s+or\s+umbrella\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[0];
    if (match) return match.replace(/\s+/g, " ").trim();
  }
  return null;
}

/**
 * Return the exact classification boundary used by the product plus the
 * smallest matching phrase. This is display evidence, never a legal SDS.
 */
export function classifyIR35Evidence(title: string, description: string): IR35ClassificationEvidence {
  const t = title ?? "";
  const d = description ?? "";

  const titleOutside = matchesAny(t, OUTSIDE_PATTERNS);
  const titleInside = matchesAny(t, INSIDE_PATTERNS);

  // Title is the strongest signal — recruiters put status there deliberately.
  if (titleOutside && !titleInside) return { status: "outside", confidence: "high", basis: "advertiser_title", evidence: firstMatch(t, OUTSIDE_PATTERNS) };
  if (titleInside && !titleOutside) return { status: "inside", confidence: "high", basis: "advertiser_title", evidence: firstMatch(t, INSIDE_PATTERNS) };
  if (titleOutside && titleInside) return { status: "unknown", confidence: "low", basis: "conflict", evidence: "Both Inside and Outside IR35 wording appears in the title" };

  const descOutside = matchesAny(d, OUTSIDE_PATTERNS);
  const descInside = matchesAny(d, INSIDE_PATTERNS);

  if (descOutside && !descInside) return { status: "outside", confidence: "medium", basis: "advertiser_listing", evidence: firstMatch(d, OUTSIDE_PATTERNS) };
  if (descInside && !descOutside) return { status: "inside", confidence: "medium", basis: "advertiser_listing", evidence: firstMatch(d, INSIDE_PATTERNS) };
  if (descOutside && descInside) {
    // Both mentioned — often "inside or outside considered" or a comparison.
    // Never guess.
    return { status: "unknown", confidence: "low", basis: "conflict", evidence: "Both Inside and Outside IR35 wording appears in the listing" };
  }

  // No explicit IR35 wording — check near-explicit inside arrangements.
  if (matchesAny(`${t} ${d}`, INSIDE_ARRANGEMENT_PATTERNS)) {
    return { status: "inside", confidence: "medium", basis: "arrangement_inference", evidence: firstMatch(`${t} ${d}`, INSIDE_ARRANGEMENT_PATTERNS) };
  }

  return { status: "unknown", confidence: "low", basis: "not_found", evidence: null };
}

export function classifyIR35(title: string, description: string): IR35Classification {
  const { status, confidence } = classifyIR35Evidence(title, description);
  return { status, confidence };
}
