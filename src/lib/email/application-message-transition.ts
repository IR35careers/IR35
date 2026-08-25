import type { ApplicationNotificationKind } from "@/lib/email/application-notifications";
import type {
  ApplicationStatus,
  InboxClassification,
} from "@/lib/workspace/types";

export interface ApplicationMessageTransition {
  status: ApplicationStatus;
  label: string;
  notification: ApplicationNotificationKind;
}

export function applicationMessageTransition(
  classification: InboxClassification,
  current: ApplicationStatus,
  message = "",
): ApplicationMessageTransition {
  const text = message.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(offer of employment|contract offer|formal offer|pleased to offer|would like to offer|offer letter)\b/.test(text))
    return {
      status: "offer",
      label: "Offer message received",
      notification: "offer",
    };
  if (classification === "interview")
    return {
      status: "interview",
      label: "Interview message received",
      notification: "interview",
    };
  if (classification === "rejection")
    return {
      status: "rejected",
      label: "Employer closed the application",
      notification: "rejection",
    };
  if (classification === "action_required")
    return {
      status: "needs_review",
      label: /\b(assessment|coding test|technical test|take home|online test|psychometric)\b/.test(text)
        ? "Application assessment received"
        : /\b(verification code|verify your|one time passcode|one time password|security code|otp)\b/.test(text)
          ? "Application verification received"
          : "Recruiter needs more information",
      notification: "needs_attention",
    };
  if (classification === "application_update")
    return {
      status:
        current === "applied"
          ? "viewed"
          : ["ready", "preparing", "needs_review"].includes(current)
            ? "applied"
            : current,
      label: "Application update received",
      notification: "update",
    };
  return {
    status: ["interview", "offer", "rejected", "withdrawn"].includes(
      current,
    )
      ? current
      : "replied",
    label: "Recruiter message received",
    notification: "reply",
  };
}
