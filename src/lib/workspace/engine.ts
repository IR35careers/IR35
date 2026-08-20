import { analyseResumeForRole } from "@/lib/resume/analysis";
import type {
  ApplicationEvent,
  ApplicationQuestion,
  ApplicationReceipt,
  ApplicationReceiptReview,
  ApplicationReceiptReviewItem,
  ApplicationRecord,
  ApplicationStatus,
  AutomationRules,
  ContractorProfile,
  PrepareApplicationInput,
} from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";

const MAX_CV_CHARACTERS = 80_000;

export function newWorkspaceId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function cleanLine(value: string, max = 240): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function evidenceSentence(matched: string[]): string {
  if (matched.length === 0) {
    return "My CV contains transferable delivery experience relevant to the responsibilities described in this contract.";
  }
  const shown = matched.slice(0, 4);
  const formatted = shown.length === 1
    ? shown[0]
    : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
  return `My background includes evidenced experience with ${formatted}, as detailed in the attached CV.`;
}

export function buildTruthPreservingCoverLetter(
  job: JobDetail,
  profile: ContractorProfile,
  matchedKeywords: string[]
): string {
  const name = cleanLine(profile.fullName || "Contractor", 100);
  const title = cleanLine(job.title, 160);
  const company = cleanLine(job.company_name, 120);
  const availability = cleanLine(profile.availability, 120);
  const clearance = cleanLine(profile.clearance, 100);

  const optional = [
    availability ? `I am currently available ${availability.toLowerCase()}.` : "",
    clearance ? `My declared clearance status is: ${clearance}.` : "",
  ].filter(Boolean);

  return [
    "Dear hiring team,",
    "",
    `I am applying for the ${title} contract with ${company}.`,
    evidenceSentence(matchedKeywords),
    `The advertised ${job.ir35_status === "outside" ? "Outside IR35" : job.ir35_status === "inside" ? "Inside IR35" : "IR35 status to be confirmed"} arrangement and ${cleanLine(job.remote_type)} working pattern are understood and can be discussed against the final working practices.`,
    ...optional,
    "",
    "I would welcome the opportunity to discuss the deliverables, working practices and evidence behind the status determination before engagement.",
    "",
    "Kind regards,",
    name,
  ].join("\n");
}

export function buildScreeningQuestions(
  job: JobDetail,
  profile: ContractorProfile
): ApplicationQuestion[] {
  return [
    {
      id: "right-to-work",
      label: "Do you have the right to work in the UK?",
      answer:
        profile.rightToWork === "yes"
          ? "Yes"
          : profile.rightToWork === "needs_sponsorship"
            ? "I require sponsorship"
            : profile.rightToWork === "no"
              ? "No"
              : "Prefer not to say",
      required: true,
      source: "profile",
      reviewed: false,
    },
    {
      id: "availability",
      label: "When are you available to start?",
      answer: cleanLine(profile.availability || profile.noticePeriod, 160),
      required: true,
      source: "profile",
      reviewed: false,
    },
    {
      id: "location",
      label: `Can you meet the advertised ${job.remote_type} working pattern in ${cleanLine(job.location)}?`,
      answer: "Please confirm before handoff",
      required: true,
      source: "user",
      reviewed: false,
    },
    {
      id: "ir35",
      label: "Have you reviewed the advertised IR35 status and working practices?",
      answer: job.ir35_status === "unknown" ? "Status needs clarification" : "Please confirm before handoff",
      required: true,
      source: "job",
      reviewed: false,
    },
  ];
}

export function prepareApplication(input: PrepareApplicationInput): ApplicationRecord {
  const cvText = input.cvText.trim();
  if (cvText.length < 120) throw new Error("Add at least 120 characters of CV evidence before preparing an application.");
  if (cvText.length > MAX_CV_CHARACTERS) throw new Error("CV text is too large. Keep it below 80,000 characters.");
  if (!input.job.id || !input.job.title || !input.job.company_name) throw new Error("The role is missing required details.");

  const analysis = analyseResumeForRole(cvText, input.resumeVersionLabel ?? "Application CV", input.job);
  const now = new Date().toISOString();
  const id = newWorkspaceId();
  const event: ApplicationEvent = {
    id: newWorkspaceId(),
    applicationId: id,
    type: "prepared",
    label: "Application materials prepared for review",
    createdAt: now,
  };

  return {
    id,
    job: input.job,
    status: "needs_review",
    matchScore: analysis.baseline.overall,
    matchedKeywords: analysis.baseline.matchedKeywords,
    missingKeywords: analysis.baseline.missingKeywords,
    sourceCvText: cvText,
    tailoredCvText: cvText,
    resumeVersionLabel: input.resumeVersionLabel ?? "Application CV",
    coverLetter: buildTruthPreservingCoverLetter(input.job, input.profile, analysis.baseline.matchedKeywords),
    questions: buildScreeningQuestions(input.job, input.profile),
    truthApproved: false,
    materialsApproved: false,
    submissionApproved: false,
    mode: "dry_run",
    receipt: null,
    createdAt: now,
    updatedAt: now,
    events: [event],
  };
}

export function applicationIsReady(application: ApplicationRecord): boolean {
  return (
    application.truthApproved &&
    application.materialsApproved &&
    application.submissionApproved &&
    application.questions.filter((question) => question.required).every((question) => question.reviewed && question.answer.trim().length > 0)
  );
}

export function issueDryRunReceipt(application: ApplicationRecord): ApplicationReceipt {
  if (!applicationIsReady(application)) {
    throw new Error("Review every required answer and complete all three approval checks first.");
  }
  const reviewedFields = application.questions.filter((question) => question.reviewed).map((question) => question.label);
  return {
    receiptId: `DRY-${Date.now().toString(36).toUpperCase()}`,
    mode: "dry_run",
    createdAt: new Date().toISOString(),
    destination: application.job.source_domain,
    reviewedFields,
    skippedFields: application.questions.filter((question) => !question.reviewed).map((question) => question.label),
    reviewedSnapshot: {
      resumeVersionLabel: application.resumeVersionLabel,
      cvText: application.tailoredCvText,
      coverLetter: application.coverLetter,
      answers: application.questions.map(({ id, label, answer, source }) => ({ id, label, answer, source })),
    },
    review: null,
    message: "Preparation complete. No application or personal data was sent to the employer, and no email was sent.",
  };
}

const RECEIPT_REVIEW_ITEMS = new Set<ApplicationReceiptReviewItem>(["cv", "cover_letter", "screening_answers", "destination", "other"]);

export function reviewApplicationReceipt(
  receipt: ApplicationReceipt,
  input: Pick<ApplicationReceiptReview, "outcome" | "flaggedItems" | "notes">
): ApplicationReceipt {
  if (input.outcome !== "accurate" && input.outcome !== "changes_needed") {
    throw new Error("Choose whether the reviewed packet was accurate or needs changes.");
  }
  const flaggedItems = [...new Set(input.flaggedItems)].filter((item) => RECEIPT_REVIEW_ITEMS.has(item));
  const notes = input.notes.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 1_200);
  if (input.outcome === "changes_needed" && flaggedItems.length === 0 && notes.length === 0) {
    throw new Error("Flag at least one item or add a note describing what should change.");
  }
  return {
    ...receipt,
    review: {
      outcome: input.outcome,
      flaggedItems,
      notes,
      savedAt: new Date().toISOString(),
    },
  };
}

export function canMoveStatus(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return true;
  if (to === "withdrawn" || to === "skipped") return true;
  const order: ApplicationStatus[] = ["draft", "needs_review", "ready", "applied", "viewed", "replied", "interview", "offer"];
  const fromIndex = order.indexOf(from);
  const toIndex = order.indexOf(to);
  if (to === "rejected" || to === "failed") return fromIndex >= 2;
  return fromIndex >= 0 && toIndex >= fromIndex;
}

export function evaluateAutomationJob(
  job: JobDetail,
  score: number,
  rules: AutomationRules
): string | null {
  if (!rules.enabled) return "Automation is paused";
  if (score < rules.minimumMatch) return `Match score is below ${rules.minimumMatch}%`;
  const rate = job.rate_max ?? job.rate_min ?? 0;
  if (rate < rules.minimumDayRate) return `Rate is below £${rules.minimumDayRate}/day`;
  if (!rules.ir35.includes(job.ir35_status)) return "IR35 status is outside your rule";
  if (!rules.workplaces.includes(job.remote_type)) return "Working pattern is outside your rule";
  const excluded = rules.excludedCompanies.some((company) => job.company_name.toLowerCase().includes(company.toLowerCase()));
  if (excluded) return "Company is excluded";
  return null;
}
