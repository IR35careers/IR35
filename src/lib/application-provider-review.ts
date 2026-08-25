import type { ApplicationQuestion } from "@/lib/workspace/types";

type ProviderQuestion = Record<string, unknown>;

function clean(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionList(review: unknown): unknown[] {
  if (Array.isArray(review)) return review;
  if (!review || typeof review !== "object") return [];
  const record = review as Record<string, unknown>;
  for (const key of ["questions", "fields", "required_fields", "items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return Object.keys(record).some((key) =>
    ["id", "key", "name", "label", "question", "prompt"].includes(key),
  )
    ? [record]
    : [];
}

function questionText(record: ProviderQuestion, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim())
      return clean(value).slice(0, 500);
  }
  return "";
}

/** Converts a submission runner review into owner-reviewed workspace questions. */
export function providerReviewQuestions(
  review: unknown,
): ApplicationQuestion[] {
  return questionList(review)
    .map((item, index) => {
      const record: ProviderQuestion =
        item && typeof item === "object"
          ? (item as ProviderQuestion)
          : { question: String(item ?? "") };
      const rawId = questionText(record, [
        "id",
        "question_id",
        "key",
        "name",
        "field",
      ]);
      const label =
        questionText(record, [
          "label",
          "question",
          "prompt",
          "title",
          "name",
        ]) || `Employer question ${index + 1}`;
      const answer = questionText(record, [
        "answer",
        "value",
        "default_value",
      ]);
      return {
        id: `provider:${rawId || `question_${index + 1}`}`,
        label,
        answer,
        required: record.required !== false,
        source: "user" as const,
        reviewed: Boolean(answer),
      };
    })
    .filter(
      (question, index, questions) =>
        question.label.length > 0 &&
        questions.findIndex((item) => item.id === question.id) === index,
    );
}
