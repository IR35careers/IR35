import type { AiTailoringResult } from "@/lib/ai/tailoring-types";
import type { JobDetail } from "@/lib/job-types";
import { applyAiTailoringSuggestions } from "@/lib/ai/tailoring";
import { analyseResumeForRole, parseResumeText, resumeContainsTerm, scoreResumeForRole } from "@/lib/resume/analysis";

/**
 * A no-network fallback for role-specific CV improvements. It only reorders or
 * tightens text already present in the CV, so tailoring remains useful when an
 * external language-model provider is unavailable.
 */
export function buildLocalTailoringResult(cvText: string, job: JobDetail): AiTailoringResult {
  const analysis = analyseResumeForRole(cvText, "Application CV", job);
  const safeSuggestions = analysis.suggestions.filter((suggestion) => !suggestion.requiresConfirmation);
  const skillsSection = parseResumeText(cvText).sections.find((section) => section.kind === "skills");
  const skillItems = skillsSection?.content
    .split(/[,|\n]+/)
    .map((item) => item.replace(/^\s*[•*-]\s*/, "").trim())
    .filter(Boolean) ?? [];
  const reorderedSkills = [...skillItems].sort((left, right) => {
    const leftScore = analysis.baseline.matchedKeywords.filter((term) => resumeContainsTerm(left, term)).length;
    const rightScore = analysis.baseline.matchedKeywords.filter((term) => resumeContainsTerm(right, term)).length;
    return rightScore - leftScore;
  });
  const skillsSuggestion = skillsSection && reorderedSkills.length >= 3
    ? {
        id: "local-skills-priority",
        section: "Skills",
        original: skillsSection.content,
        replacement: reorderedSkills.map((item) => `- ${item}`).join("\n"),
        rationale: "Moves the most relevant existing skills into the first scan positions without adding new capabilities.",
        evidenceQuote: skillsSection.content,
        keywords: analysis.baseline.matchedKeywords.filter((term) => resumeContainsTerm(skillsSection.content, term)).slice(0, 8),
        impact: "high" as const,
      }
    : null;
  const suggestions = [
    ...safeSuggestions.map((suggestion, index) => ({
      id: `local-${suggestion.id}`,
      section: suggestion.kind === "summary" ? "Profile" : "Experience",
      original: suggestion.original,
      replacement: suggestion.replacement,
      rationale: suggestion.rationale,
      evidenceQuote: suggestion.original,
      keywords: suggestion.evidenceTerms,
      impact: index === 0 ? "high" as const : "medium" as const,
    })),
    ...(skillsSuggestion ? [skillsSuggestion] : []),
  ];

  return {
    model: "ir35careers-evidence-engine",
    summary: suggestions.length
      ? "Role-specific improvements are ready for review."
      : "Your CV is already using the role-relevant evidence the local review could verify.",
    mustHaveRequirements: job.skills.slice(0, 12),
    niceToHaveRequirements: [],
    suggestions,
    coverLetter: "",
    baseline: analysis.baseline,
    projected: scoreResumeForRole(applyAiTailoringSuggestions(cvText, suggestions), job, "Application CV"),
    privacy: {
      directIdentifiersRedacted: true,
      zeroDataRetentionRequested: true,
      dataCollectionDenied: true,
    },
  };
}
