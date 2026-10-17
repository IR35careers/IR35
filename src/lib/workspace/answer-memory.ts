import type {
  ApplicationQuestion,
  ContractorProfile,
  SavedApplicationAnswer,
} from "@/lib/workspace/types";

const MAX_SAVED_ANSWERS = 120;

export function normaliseApplicationQuestionLabel(value: string): string {
  return value
    .toLocaleLowerCase("en-GB")
    .replace(/\b(?:please|kindly|required)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reusable(question: ApplicationQuestion): boolean {
  const label = normaliseApplicationQuestionLabel(question.label);
  if (!question.reviewed || !question.answer.trim() || label.length < 8)
    return false;
  // Never turn per-employer declarations, consent or security challenges into
  // silent global answers. The runner must ask again when these appear.
  return !/(?:password|verification code|captcha|signature|terms|privacy|consent|declare|conviction|criminal|disability|health|medical|gender|ethnic|race|religion|date of birth|national insurance|passport|worked for .* before)/i.test(
    question.label,
  );
}

export function rememberReviewedApplicationAnswers(
  profile: ContractorProfile,
  questions: ApplicationQuestion[],
  now = new Date().toISOString(),
): ContractorProfile {
  const remembered = new Map<string, SavedApplicationAnswer>();
  for (const answer of profile.savedApplicationAnswers ?? []) {
    const key = normaliseApplicationQuestionLabel(answer.label);
    if (key && answer.answer.trim()) remembered.set(key, answer);
  }
  for (const question of questions) {
    if (!reusable(question)) continue;
    const key = normaliseApplicationQuestionLabel(question.label);
    remembered.set(key, {
      id: question.id,
      label: question.label.trim(),
      answer: question.answer.trim(),
      updatedAt: now,
    });
  }
  return {
    ...profile,
    savedApplicationAnswers: [...remembered.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_SAVED_ANSWERS),
  };
}

export function applyRememberedApplicationAnswers(
  questions: ApplicationQuestion[],
  saved: SavedApplicationAnswer[] | undefined,
): ApplicationQuestion[] {
  if (!saved?.length) return questions;
  const remembered = new Map(
    saved
      .filter((item) => item.answer.trim())
      .map((item) => [normaliseApplicationQuestionLabel(item.label), item]),
  );
  return questions.map((question) => {
    if (question.answer.trim()) return question;
    const match = remembered.get(
      normaliseApplicationQuestionLabel(question.label),
    );
    return match
      ? {
          ...question,
          answer: match.answer,
          source: "profile" as const,
          reviewed: true,
        }
      : question;
  });
}

export function mergeApplicationAnswerMemory(
  saved: SavedApplicationAnswer[] | undefined,
  current: ApplicationQuestion[],
): ApplicationQuestion[] {
  const merged = new Map<string, ApplicationQuestion>();
  for (const item of saved ?? []) {
    const key = normaliseApplicationQuestionLabel(item.label);
    if (!key || !item.answer.trim()) continue;
    merged.set(key, {
      id: `remembered:${item.id}`,
      label: item.label,
      answer: item.answer,
      required: false,
      source: "profile",
      reviewed: true,
    });
  }
  for (const question of current) {
    const key = normaliseApplicationQuestionLabel(question.label);
    if (key) merged.set(key, question);
  }
  return [...merged.values()];
}
