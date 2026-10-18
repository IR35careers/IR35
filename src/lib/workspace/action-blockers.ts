import { resolveCandidateName } from "@/lib/candidate-name";
import { applicationProfileHref } from "@/lib/application-profile-return";
import { evaluateApplicationReadiness } from "./profile-readiness";
import type { ApplicationRecord, ContractorProfile } from "./types";

export interface ActionBlocker {
  id: string;
  message: string;
  actionLabel?: string;
  targetId?: string;
  href?: string;
}

const BUSY_MESSAGES = {
  parse: "Wait for your CV upload to finish.",
  prepare: "Wait for application preparation to finish.",
  ai: "Wait for CV tailoring to finish and review the changes.",
  save: "Wait for your application changes to finish saving.",
  submit: "Your submission request is in progress. Do not start another attempt.",
} as const;

/** These are client-known gates, not a prediction of employer/credit eligibility. */
export function applicationSubmitBlockers(input: {
  application: ApplicationRecord;
  profile: ContractorProfile;
  fallbackEmail?: string;
  busy: keyof typeof BUSY_MESSAGES | null;
  submissionInProgress: boolean;
}): ActionBlocker[] {
  const { application, profile, busy } = input;
  if (input.submissionInProgress) return [{ id: "in-flight", message: application.deliveryStatus === "queued"
    ? "Your application is queued. Wait for its saved status to update; do not submit it again."
    : "Your application is being submitted. Wait for employer confirmation; do not submit it again." }];
  if (application.deliveryStatus === "skipped" || application.status === "skipped")
    return [{ id: "skipped", message: "This application was skipped and cannot be submitted." }];

  const blockers: ActionBlocker[] = busy ? [{ id: "busy", message: BUSY_MESSAGES[busy] }] : [];
  const cv = application.tailoredCvText || application.sourceCvText;
  const readiness = evaluateApplicationReadiness({ ...profile,
    fullName: resolveCandidateName(profile.fullName, cv) || "",
    email: profile.email || profile.forwardingEmail || input.fallbackEmail || "",
  }, cv);
  for (const item of readiness.missing) blockers.push(item.id === "cv"
    ? { id: "profile:cv", message: "Add a readable CV with at least 120 characters.", actionLabel: "Review application CV", targetId: "application-cv-text" }
    : { id: `profile:${item.id}`, message: `Add your ${item.label.toLowerCase()}.`,
      actionLabel: `Add ${item.label.toLowerCase()}`, href: applicationProfileHref(application.job.id, item.id) });
  for (const question of application.questions) {
    if (!question.required || (question.reviewed && question.answer.trim())) continue;
    blockers.push({ id: `answer:${question.id}`, message: question.answer.trim()
      ? `Confirm your answer to “${question.label}”.` : `Answer “${question.label}”.`,
      actionLabel: "Review answer", targetId: `question-${question.id}` });
  }
  if (!application.truthApproved || !application.materialsApproved || !application.submissionApproved)
    blockers.push({ id: "approval", message: "Approve this application to confirm the CV and answers and authorise submission.",
      actionLabel: "Review final approval", targetId: "application-final-approval" });
  return blockers;
}

export function autoApplyActionBlockers(input: {
  busy: "preview" | "apply" | null;
  enabled: boolean;
  consentAccepted: boolean;
}): ActionBlocker[] {
  const blockers: ActionBlocker[] = [];
  if (input.busy) blockers.push({ id: "busy", message: input.busy === "preview"
    ? "Wait for the match preview to finish."
    : "An Auto Apply request is in progress. Check Tracker before starting another." });
  if (!input.enabled) blockers.push({ id: "enabled", message: "Auto Apply is paused. Turn it on in Matches.",
    actionLabel: "Open Auto Apply switch", targetId: "auto-apply-toggle" });
  if (!input.consentAccepted) blockers.push({ id: "consent", message: "Confirm permission to apply using your approved profile, CV and answers.",
    actionLabel: "Review permission", targetId: "auto-apply-consent" });
  return blockers;
}
