import type { JobDetail } from "@/lib/job-types";

export type ApplicationStatus =
  | "draft"
  | "ready"
  | "needs_review"
  | "applied"
  | "viewed"
  | "replied"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn"
  | "failed"
  | "skipped";

export type InboxClassification =
  | "interview"
  | "rejection"
  | "action_required"
  | "application_update"
  | "other";

export interface ContractorProfile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedInUrl: string;
  portfolioUrl: string;
  rightToWork: "yes" | "no" | "needs_sponsorship" | "prefer_not_to_say";
  availability: string;
  noticePeriod: string;
  limitedCompanyName: string;
  companyNumber: string;
  vatRegistered: boolean;
  clearance: string;
  defaultCvLabel: string;
  forwardingEmail: string;
  networkContacts?: NetworkContact[];
  referralRequests?: ReferralRequest[];
}

export type NetworkContactStage = "identified" | "warm" | "asked" | "referred" | "closed";

export interface NetworkContact {
  id: string;
  name: string;
  company: string;
  role: string;
  relationship: string;
  channel: string;
  notes: string;
  nextFollowUp: string;
  stage: NetworkContactStage;
  createdAt: string;
  updatedAt: string;
}

export type ReferralRequestStatus = "draft" | "reviewed" | "copied" | "responded";

export interface ReferralRequest {
  id: string;
  contactId: string;
  jobId: string;
  jobTitle: string;
  company: string;
  listingUrl: string;
  message: string;
  status: ReferralRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationQuestion {
  id: string;
  label: string;
  answer: string;
  required: boolean;
  source: "profile" | "user" | "job";
  reviewed: boolean;
}

export interface ApplicationReceipt {
  receiptId: string;
  mode: "dry_run" | "external_handoff";
  createdAt: string;
  destination: string;
  reviewedFields: string[];
  skippedFields: string[];
  message: string;
}

export interface ApplicationEvent {
  id: string;
  applicationId: string;
  type: "created" | "prepared" | "approved" | "status_changed" | "message_received" | "note";
  label: string;
  createdAt: string;
}

export interface ApplicationRecord {
  id: string;
  job: JobDetail;
  status: ApplicationStatus;
  matchScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  sourceCvText: string;
  tailoredCvText: string;
  resumeVersionLabel: string;
  coverLetter: string;
  questions: ApplicationQuestion[];
  truthApproved: boolean;
  materialsApproved: boolean;
  submissionApproved: boolean;
  mode: "dry_run" | "external_handoff";
  receipt: ApplicationReceipt | null;
  createdAt: string;
  updatedAt: string;
  events: ApplicationEvent[];
}

export interface InboxMessage {
  id: string;
  applicationId: string | null;
  from: string;
  subject: string;
  preview: string;
  body: string;
  classification: InboxClassification;
  receivedAt: string;
  read: boolean;
}

export interface AutomationRules {
  enabled: boolean;
  dryRunOnly: true;
  minimumMatch: number;
  minimumDayRate: number;
  ir35: Array<"outside" | "inside" | "unknown">;
  workplaces: Array<"remote" | "hybrid" | "onsite" | "unknown">;
  dailyLimit: number;
  prepareCoverLetter: boolean;
  requireHumanApproval: true;
  excludedCompanies: string[];
}

export interface AutomationPreview {
  id: string;
  createdAt: string;
  matchingJobIds: string[];
  skipped: Array<{ jobId: string; reason: string }>;
}

export interface InboxSettings {
  alias: string;
  forwardingEmail: string;
  forwardingEnabled: boolean;
  providerState: "preview" | "not_connected" | "connected";
}

export interface Entitlement {
  plan: "preview" | "free" | "pro";
  preparationCredits: number;
  billingState: "not_connected" | "sandbox" | "active" | "past_due" | "cancelled";
}

export interface WorkspaceState {
  version: 1;
  profile: ContractorProfile;
  applications: ApplicationRecord[];
  messages: InboxMessage[];
  automation: AutomationRules;
  automationRuns: AutomationPreview[];
  inbox: InboxSettings;
  entitlement: Entitlement;
}

export interface PrepareApplicationInput {
  job: JobDetail;
  profile: ContractorProfile;
  cvText: string;
  resumeVersionLabel?: string;
}
