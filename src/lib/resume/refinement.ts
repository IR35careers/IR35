import { applyAiTailoringSuggestions } from "@/lib/ai/tailoring";
import type { AiTailoringSuggestion } from "@/lib/ai/tailoring-types";
import type { ApplicationRecord } from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";
import { scoreResumeForRole } from "@/lib/resume/analysis";
import { normaliseResumeText } from "@/lib/resume/normalise-text";
import { hasActiveSubmission } from "@/lib/application-submission-state";

export interface RefinedResumeDraft {
  sourceText: string;
  tailoredText: string;
  acceptedSuggestionIds: string[];
  confirmedEvidence: string;
}

/** User edits are explicit, never inferred from a missing keyword. */
export function buildRefinedResumeDraft(input: {
  sourceText: string;
  suggestions: AiTailoringSuggestion[];
  selectedIds: string[];
  replacements?: Record<string, string>;
  evidence?: string;
  evidenceConfirmed?: boolean;
}): RefinedResumeDraft {
  const selected = input.suggestions.filter((item) => input.selectedIds.includes(item.id));
  if (selected.some((item) => item.original.trim() && !input.sourceText.includes(item.original))) {
    throw new Error("The resume changed after this review. Refine it again before using these edits.");
  }
  const evidence = normaliseResumeText(input.evidence ?? "").trim();
  if (evidence && (!input.evidenceConfirmed || evidence.length < 20)) {
    throw new Error("Describe your real experience and confirm it is accurate before adding it.");
  }
  const changes = selected.map((item) => ({ ...item, replacement: input.replacements?.[item.id] ?? item.replacement }));
  let tailoredText = input.sourceText;
  for (const change of changes) {
    if (change.original.trim() && !tailoredText.includes(change.original)) throw new Error("These edits overlap. Choose one alternative for the same source wording.");
    tailoredText = applyAiTailoringSuggestions(tailoredText, [change]);
  }
  return {
    sourceText: input.sourceText,
    tailoredText: normaliseResumeText(evidence ? `${tailoredText}\n\nADDITIONAL EXPERIENCE\n${evidence}` : tailoredText),
    acceptedSuggestionIds: selected.map((item) => item.id),
    confirmedEvidence: evidence,
  };
}

/** Refining material never approves or submits an application implicitly. */
export function applyRefinedResume(application: ApplicationRecord, draft: RefinedResumeDraft, job: JobDetail): ApplicationRecord {
  if (application.job.id !== job.id) throw new Error("Choose a resume version for this specific job.");
  if (["applied", "viewed", "replied", "interview", "offer", "rejected", "withdrawn"].includes(application.status) || hasActiveSubmission(application.status, application.events, application.attention)) {
    throw new Error("The submitted or processing resume cannot be replaced.");
  }
  if (draft.sourceText !== application.tailoredCvText) throw new Error("The resume changed after this review. Refine it again before using these edits.");
  const score = scoreResumeForRole(draft.tailoredText, job, application.resumeVersionLabel);
  return { ...application, tailoredCvText: draft.tailoredText, matchScore: score.overall,
    matchedKeywords: score.matchedKeywords, missingKeywords: score.missingKeywords,
    truthApproved: false, materialsApproved: false, submissionApproved: false, status: "needs_review" };
}
