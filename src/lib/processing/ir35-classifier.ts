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

// "outside ir35", "outside of ir-35", "ir35: outside", "determination: outside",
// "deemed outside", "outside ir35 contract" ...
const OUTSIDE_PATTERNS = [
  /\boutside\s*(?:of\s*)?ir\s*-?\s*35\b/i,
  /\bir\s*-?\s*35\s*(?:status)?\s*[:\-–]\s*outside\b/i,
  /\bir\s*-?\s*35\s*determination\s*[:\-–]?\s*outside\b/i,
  /\bdeemed\s+outside\s+(?:of\s+)?ir\s*-?\s*35\b/i,
  /\bdetermined\s+(?:as\s+)?outside\b[^.]{0,30}\bir\s*-?\s*35\b/i,
  /\boutside\s*-\s*ir35\b/i,
];

const INSIDE_PATTERNS = [
  /\binside\s*(?:of\s*)?ir\s*-?\s*35\b/i,
  /\bir\s*-?\s*35\s*(?:status)?\s*[:\-–]\s*inside\b/i,
  /\bir\s*-?\s*35\s*determination\s*[:\-–]?\s*inside\b/i,
  /\bdeemed\s+inside\s+(?:of\s+)?ir\s*-?\s*35\b/i,
  /\bdetermined\s+(?:as\s+)?inside\b[^.]{0,30}\bir\s*-?\s*35\b/i,
  /\binside\s*-\s*ir35\b/i,
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

export function classifyIR35(title: string, description: string): IR35Classification {
  const t = title ?? "";
  const d = description ?? "";

  const titleOutside = matchesAny(t, OUTSIDE_PATTERNS);
  const titleInside = matchesAny(t, INSIDE_PATTERNS);

  // Title is the strongest signal — recruiters put status there deliberately.
  if (titleOutside && !titleInside) return { status: "outside", confidence: "high" };
  if (titleInside && !titleOutside) return { status: "inside", confidence: "high" };
  if (titleOutside && titleInside) return { status: "unknown", confidence: "low" };

  const descOutside = matchesAny(d, OUTSIDE_PATTERNS);
  const descInside = matchesAny(d, INSIDE_PATTERNS);

  if (descOutside && !descInside) return { status: "outside", confidence: "medium" };
  if (descInside && !descOutside) return { status: "inside", confidence: "medium" };
  if (descOutside && descInside) {
    // Both mentioned — often "inside or outside considered" or a comparison.
    // Never guess.
    return { status: "unknown", confidence: "low" };
  }

  // No explicit IR35 wording — check near-explicit inside arrangements.
  if (matchesAny(`${t} ${d}`, INSIDE_ARRANGEMENT_PATTERNS)) {
    return { status: "inside", confidence: "medium" };
  }

  return { status: "unknown", confidence: "low" };
}
