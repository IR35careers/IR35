import type { AiTailoringResult } from "@/lib/ai/tailoring-types";
import type { JobDetail } from "@/lib/job-types";
import { analyseResumeForRole } from "@/lib/resume/analysis";

/**
 * A no-network fallback for role-specific CV improvements. It only reorders or
 * tightens text already present in the CV, so tailoring remains useful when an
 * external language-model provider is unavailable.
 */
export function buildLocalTailoringResult(cvText: string, job: JobDetail): AiTailoringResult {
  const analysis = analyseResumeForRole(cvText, "Application CV", job);
  const safeSuggestions = analysis.suggestions.filter((suggestion) => !suggestion.requiresConfirmation);

  return {
    model: "ir35careers-evidence-engine",
    summary: safeSuggestions.length
      ? "Role-specific improvements are ready for review."
      : "Your CV is already using the role-relevant evidence the local review could verify.",
    mustHaveRequirements: job.skills.slice(0, 12),
    niceToHaveRequirements: [],
    suggestions: safeSuggestions.map((suggestion, index) => ({
      id: `local-${suggestion.id}`,
      section: suggestion.kind === "summary" ? "Profile" : "Experience",
      original: suggestion.original,
      replacement: suggestion.replacement,
      rationale: suggestion.rationale,
      evidenceQuote: suggestion.original,
      keywords: suggestion.evidenceTerms,
      impact: index === 0 ? "high" : "medium",
    })),
    coverLetter: "",
    baseline: analysis.baseline,
    projected: analysis.projected,
    privacy: {
      directIdentifiersRedacted: true,
      zeroDataRetentionRequested: true,
      dataCollectionDenied: true,
    },
  };
}
