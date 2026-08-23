import type { ApplicationQuestion } from "@/lib/workspace/types";

export function needsApplicationMaterialApproval(
  questions: ApplicationQuestion[],
): boolean {
  return questions.some((question) => question.required && !question.reviewed);
}
