import type {
  ApplicationAttention,
  ApplicationQuestion,
} from "@/lib/workspace/types";

function clean(value: string | undefined, max = 500): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function buildApplicationAttention(input: {
  action?: string;
  message?: string;
  questions?: ApplicationQuestion[];
}): ApplicationAttention {
  const action = clean(input.action, 120);
  const message =
    clean(input.message) ||
    "The employer needs one more item before the application can continue.";
  const questionIds = (input.questions ?? [])
    .filter((question) => question.required && !question.answer.trim())
    .map((question) => question.id);

  if (action === "browser_continue" && questionIds.length > 0) {
    return {
      kind: "employer_form",
      title: `Answer ${questionIds.length} employer question${questionIds.length === 1 ? "" : "s"}`,
      message,
      action: "#needs-attention",
      actionLabel: questionIds.length === 1 ? "Answer question" : "Answer questions",
      questionIds,
    };
  }

  if (action === "/profile" || questionIds.length > 0) {
    return {
      kind: questionIds.length > 0 ? "answer_questions" : "profile_missing",
      title:
        questionIds.length > 0
          ? `Answer ${questionIds.length} employer question${questionIds.length === 1 ? "" : "s"}`
          : "Complete your application profile",
      message,
      action:
        questionIds.length > 0
          ? "#needs-attention"
          : "/profile#application-readiness",
      actionLabel: questionIds.length > 0 ? "Answer now" : "Complete profile",
      questionIds,
    };
  }
  if (action === "verification_code") {
    return {
      kind: "email_verification",
      title: "Email verification is required",
      message,
      action: "#needs-attention",
      actionLabel: "Check verification",
      questionIds,
    };
  }
  if (action === "employer_login") {
    return {
      kind: "employer_account",
      title: "Employer account needs attention",
      message,
      action: "#needs-attention",
      actionLabel: "Resolve sign in",
      questionIds,
    };
  }
  if (action === "employer_terms") {
    return {
      kind: "employer_account",
      title: "Allow required employer account terms",
      message,
      action: "#employer-terms-consent",
      actionLabel: "Allow and retry",
      questionIds,
    };
  }
  if (action === "captcha") {
    return {
      kind: "security_check",
      title: "Complete the employer security check",
      message,
      action: "#needs-attention",
      actionLabel: "Open secure check",
      questionIds,
    };
  }
  if (action === "source_access_denied") {
    return {
      kind: "employer_form",
      title: "Employer application page unavailable",
      message,
      action: "#needs-attention",
      actionLabel: "Retry application",
      questionIds,
    };
  }
  if (
    [
      "browser_continue",
      "unsupported_form",
      "validation_failed",
      "form_too_long",
      "unsupported_portal",
      "runner_timeout",
    ].includes(action)
  ) {
    return {
      kind: "employer_form",
      title:
        action === "browser_continue" || action === "runner_timeout"
          ? "Application paused before confirmation"
          : "Review the employer form",
      message,
      action: "#needs-attention",
      actionLabel:
        action === "browser_continue" || action === "runner_timeout"
          ? "Retry application"
          : "Review form",
      questionIds,
    };
  }
  return {
    kind: "retry",
    title: "Application needs another attempt",
    message,
    action: "#needs-attention",
    actionLabel: "Review and retry",
    questionIds,
  };
}
