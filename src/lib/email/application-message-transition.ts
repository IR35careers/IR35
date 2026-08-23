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
): ApplicationMessageTransition {
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
      label: "Recruiter needs more information",
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
