import { applyAiTailoringSuggestions } from "@/lib/ai/tailoring";
import type { AiTailoringResult } from "@/lib/ai/tailoring-types";
import type {
  ApplicationPreferences,
  ApplicationQuestion,
  ApplicationRecord,
  AutoApplyLane,
} from "@/lib/workspace/types";

export const AUTO_APPLY_CONSENT_VERSION = "2026-08-21";

export const DEFAULT_AUTO_APPLY_LANES: AutoApplyLane[] = [
  { id: "primary", role: "", keywords: [], location: "United Kingdom", enabled: true },
];

export function hasCurrentAutoApplyConsent(input: {
  enabled?: boolean;
  consentAt?: string;
  consentVersion?: string;
}): boolean {
  if (!input.enabled || input.consentVersion !== AUTO_APPLY_CONSENT_VERSION || !input.consentAt) return false;
  return Number.isFinite(Date.parse(input.consentAt));
}

export function unresolvedRequiredQuestions(questions: ApplicationQuestion[]): ApplicationQuestion[] {
  return questions.filter((question) => question.required && (!question.reviewed || !question.answer.trim()));
}

export function autoApplyNeedsReview(
  preferences: Pick<
    ApplicationPreferences,
    "resumeOptimisation" | "autoApproveSafeEdits" | "reviewBeforeSubmit"
  >,
): boolean {
  return Boolean(
    preferences.reviewBeforeSubmit ||
      (preferences.resumeOptimisation !== "off" &&
        !preferences.autoApproveSafeEdits),
  );
}

export function autoApplyReviewReason(
  preferences: Pick<
    ApplicationPreferences,
    "resumeOptimisation" | "autoApproveSafeEdits" | "reviewBeforeSubmit"
  >,
): string {
  if (
    preferences.resumeOptimisation !== "off" &&
    !preferences.autoApproveSafeEdits
  )
    return "Your role-specific Resume changes are ready for review.";
  return "Your application is prepared and waiting for your final review.";
}

export function applyTailoringResult(application: ApplicationRecord, result: AiTailoringResult): ApplicationRecord {
  const tailoredCvText = applyAiTailoringSuggestions(application.sourceCvText, result.suggestions);
  return {
    ...application,
    tailoredCvText,
    coverLetter: result.coverLetter.trim() || application.coverLetter,
    matchScore: result.projected.overall,
    matchedKeywords: result.projected.matchedKeywords,
    missingKeywords: result.projected.missingKeywords,
    updatedAt: new Date().toISOString(),
  };
}

export function laneMatchesJob(lanes: AutoApplyLane[] | undefined, job: { title: string; description: string; location: string }): boolean {
  const enabled = (lanes ?? DEFAULT_AUTO_APPLY_LANES).filter((lane) => lane.enabled && (lane.role.trim() || lane.keywords.length));
  if (enabled.length === 0) return true;
  const haystack = `${job.title} ${job.description}`.toLocaleLowerCase("en-GB");
  const location = job.location.toLocaleLowerCase("en-GB");
  return enabled.some((lane) => {
    const roleMatch = !lane.role.trim() || haystack.includes(lane.role.trim().toLocaleLowerCase("en-GB"));
    const keywordMatch = lane.keywords.length === 0 || lane.keywords.some((keyword) => haystack.includes(keyword.toLocaleLowerCase("en-GB")));
    const locationMatch = !lane.location.trim() || /united kingdom|uk|anywhere/i.test(lane.location) || location.includes(lane.location.toLocaleLowerCase("en-GB"));
    return roleMatch && keywordMatch && locationMatch;
  });
}
