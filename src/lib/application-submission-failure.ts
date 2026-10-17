export interface ApplicationSubmissionFailure {
  code:
    | "employer_unavailable"
    | "employer_form_failed"
    | "destination_unavailable"
    | "cv_unavailable"
    | "temporary_runner_error";
  message: string;
}

function clean(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Convert provider and infrastructure errors into safe, actionable copy. */
export function applicationSubmissionFailure(
  error: unknown,
): ApplicationSubmissionFailure {
  const message = error instanceof Error ? clean(error.message) : "";
  if (message === "The employer application page is unavailable or closed.")
    return { code: "employer_unavailable", message };
  if (message === "The employer form could not be completed.")
    return { code: "employer_form_failed", message };
  if (
    message === "This contract has no valid secure application destination." ||
    /application URL|public HTTPS|public website|application destination/i.test(
      message,
    )
  )
    return {
      code: "destination_unavailable",
      message:
        "IR35Careers could not verify the employer application page. No application was sent. Review the role link, then select Apply again.",
    };
  if (/approved Resume|resume|source page/i.test(message))
    return {
      code: "cv_unavailable",
      message:
        "IR35Careers could not load the approved Resume for this attempt. No application was sent. Open the application and select Apply again.",
    };
  return {
    code: "temporary_runner_error",
    message:
      "IR35Careers encountered a temporary connection issue before employer confirmation. No application was marked as submitted. Open the application and select Apply again.",
  };
}
