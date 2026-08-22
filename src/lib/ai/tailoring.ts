import type { AiTailoringSuggestion } from "@/lib/ai/tailoring-types";
import { normaliseResumeText } from "@/lib/resume/normalise-text";

/** Applies only edits that still match the exact source text the user reviewed. */
export function applyAiTailoringSuggestions(
  sourceCv: string,
  suggestions: AiTailoringSuggestion[],
): string {
  let result = sourceCv;
  for (const suggestion of suggestions) {
    if (result.includes(suggestion.original)) {
      result = result.replace(
        suggestion.original,
        normaliseResumeText(suggestion.replacement),
      );
    }
  }
  return normaliseResumeText(result);
}
