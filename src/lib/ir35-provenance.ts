import type { JobDetail } from "@/lib/job-types";
import { classifyIR35Evidence } from "@/lib/processing/ir35-classifier";

export type IR35ProvenanceKind = "advertised" | "inferred" | "source_or_review" | "unconfirmed";

export interface IR35Provenance {
  kind: IR35ProvenanceKind;
  label: string;
  shortLabel: string;
  explanation: string;
  evidence: string | null;
  observedLabel: string;
  confidenceLabel: string;
}

function formatObservedDate(value: string | undefined): string {
  if (!value) return "Evidence date unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Evidence date unavailable";
  return `Evidence checked ${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)}`;
}

/**
 * Explain how the stored IR35 label relates to visible listing evidence.
 * A source/review state is used when the current text cannot reproduce the
 * stored label; we never invent a manual-review claim without an audit field.
 */
export function deriveIR35Provenance(
  job: Pick<JobDetail, "title" | "description" | "ir35_status" | "ir35_confidence" | "first_seen_at" | "last_seen_at">
): IR35Provenance {
  const classified = classifyIR35Evidence(job.title, job.description);
  const observedLabel = formatObservedDate(job.last_seen_at ?? job.first_seen_at);
  const confidenceLabel = `${job.ir35_confidence[0].toUpperCase()}${job.ir35_confidence.slice(1)} confidence`;

  if (job.ir35_status === "unknown") {
    if (classified.basis === "conflict") {
      return {
        kind: "unconfirmed",
        label: "Conflicting advertiser wording",
        shortLabel: "Conflicting wording. Confirm before applying",
        explanation: "The listing contains both Inside and Outside IR35 wording, so IR35Careers does not choose a status. Ask for the engagement's Status Determination Statement (SDS).",
        evidence: classified.evidence,
        observedLabel,
        confidenceLabel,
      };
    }
    return {
      kind: "unconfirmed",
      label: "Not stated by the advertiser",
      shortLabel: "No explicit status found",
      explanation: "No reliable IR35 determination was found in the title or listing text. Treat the status as unconfirmed and ask for the SDS before accepting the engagement.",
      evidence: null,
      observedLabel,
      confidenceLabel,
    };
  }

  if (classified.status === job.ir35_status) {
    if (classified.basis === "advertiser_title" || classified.basis === "advertiser_listing") {
      const location = classified.basis === "advertiser_title" ? "job title" : "listing text";
      return {
        kind: "advertised",
        label: "Advertiser-stated",
        shortLabel: `Advertiser-stated in the ${location}`,
        explanation: `Explicit ${job.ir35_status === "outside" ? "Outside" : "Inside"} IR35 wording was found in the ${location}. This reports the advert; it is not an independent legal determination.`,
        evidence: classified.evidence,
        observedLabel,
        confidenceLabel,
      };
    }

    if (classified.basis === "arrangement_inference") {
      return {
        kind: "inferred",
        label: "Arrangement-derived signal",
        shortLabel: "Inferred from umbrella/PAYE wording",
        explanation: "The advert does not state an IR35 determination, but it does specify an umbrella/PAYE-only arrangement. IR35Careers treats that as an Inside IR35 signal; confirm the actual SDS and working practices.",
        evidence: classified.evidence,
        observedLabel,
        confidenceLabel,
      };
    }
  }

  return {
    kind: "source_or_review",
    label: "Source-supplied or reviewed",
    shortLabel: "Status not reproducible from current text",
    explanation: `The stored ${job.ir35_status === "outside" ? "Outside" : "Inside"} IR35 label cannot be reproduced from the current title and description. It may have come from structured source data or a review; verify it on the original advert and request the SDS.`,
    evidence: null,
    observedLabel,
    confidenceLabel,
  };
}
