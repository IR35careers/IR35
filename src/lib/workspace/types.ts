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

export interface ResumeProfile {
  id: string;
  name: string;
  resumeText: string;
  coverLetter: string;
  isDefault: boolean;
  format?: {
    template: "Professional" | "Modern" | "Simple";
    font: "Arial" | "Calibri" | "Georgia";
    fontSize: number;
    alignment: "left" | "justify";
    compactSpacing: boolean;
    hiddenSections: string[];
  };
}

export interface ApplicationPreferences {
  resumeOptimisation: "off" | "honest" | "strong";
  autoApproveSafeEdits: boolean;
  reviewBeforeSubmit: boolean;
  generateCoverLetter: boolean;
  usePrivateApplicationEmail: boolean;
  autoApplyEnabled?: boolean;
  autoApplyConsentAt?: string;
  autoApplyConsentVersion?: string;
  autoApplyLanes?: AutoApplyLane[];
}

export interface AutoApplyLane {
  id: string;
  role: string;
  keywords: string[];
  location: string;
  enabled: boolean;
}

export interface ContractorProfile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  addressLine1?: string;
  city?: string;
  county?: string;
  postcode?: string;
  country?: string;
  isOver18?: boolean | null;
  linkedInUrl: string;
  portfolioUrl: string;
  rightToWork: "yes" | "no" | "needs_sponsorship" | "prefer_not_to_say";
  canWorkInPerson?: boolean | null;
  canRelocate?: boolean | null;
  canStartImmediately?: boolean | null;
  hasTransportation?: boolean | null;
  needsAccommodation?: boolean | null;
  workedForCompanyBefore?: boolean | null;
  hasGovernmentClearance?: boolean | null;
  hasGovernmentTies?: boolean | null;
  willingToTravel?: boolean | null;
  willingToWorkShifts?: boolean | null;
  willingToWorkWeekends?: boolean | null;
  backgroundCheckConsent?: boolean | null;
  criminalConvictionsToDeclare?: boolean | null;
  targetDayRate?: string;
  targetAnnualSalary?: string;
  yearsOfExperience?: string;
  referralSource?: string;
  portalAccountConsent?: boolean;
  employerTermsConsent?: boolean;
  automaticEmailVerification?: boolean;
  employerAutomationConsentAt?: string;
  employerAutomationConsentVersion?: string;
  profileSetupCompletedAt?: string;
  educationInstitution?: string;
  educationQualification?: string;
  availability: string;
  noticePeriod: string;
  limitedCompanyName: string;
  companyNumber: string;
  vatRegistered: boolean;
  clearance: string;
  defaultCvLabel: string;
  forwardingEmail: string;
  professionalSummary?: string;
  targetRole?: string;
  githubUrl?: string;
  githubProfile?: {
    username: string;
    avatarUrl: string;
    profileUrl: string;
    company: string;
    publicRepos: number;
    followers: number;
    languages: string[];
    importedProjects: number;
    connectedAt: string;
    syncedAt: string;
  };
  skills?: string[];
  certifications?: string[];
  experienceText?: string;
  projectsText?: string;
  resumeProfiles?: ResumeProfile[];
  activeResumeProfileId?: string;
  applicationPreferences?: ApplicationPreferences;
  networkContacts?: NetworkContact[];
  referralRequests?: ReferralRequest[];
  savedApplicationAnswers?: SavedApplicationAnswer[];
  experience?: {
    dashboardTourCompletedAt?: string;
  };
}

export interface SavedApplicationAnswer {
  id: string;
  label: string;
  answer: string;
  updatedAt: string;
}

export type NetworkContactStage =
  "identified" | "warm" | "asked" | "referred" | "closed";

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

export type ReferralRequestStatus =
  "draft" | "reviewed" | "copied" | "responded";

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
  reviewedSnapshot?: {
    resumeVersionLabel: string;
    cvText: string;
    coverLetter: string;
    answers: Array<
      Pick<ApplicationQuestion, "id" | "label" | "answer" | "source">
    >;
  };
  review?: ApplicationReceiptReview | null;
  message: string;
}

export type ApplicationReceiptReviewItem =
  "cv" | "cover_letter" | "screening_answers" | "destination" | "other";

export interface ApplicationReceiptReview {
  outcome: "accurate" | "changes_needed";
  flaggedItems: ApplicationReceiptReviewItem[];
  notes: string;
  savedAt: string;
}

export interface ApplicationEvent {
  id: string;
  applicationId: string;
  type:
    | "created"
    | "prepared"
    | "approved"
    | "status_changed"
    | "message_received"
    | "note";
  label: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type ApplicationAttentionKind =
  | "profile_missing"
  | "answer_questions"
  | "email_verification"
  | "employer_account"
  | "security_check"
  | "employer_form"
  | "retry";

export interface ApplicationAttention {
  kind: ApplicationAttentionKind;
  title: string;
  message: string;
  action: string;
  actionLabel: string;
  questionIds: string[];
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
  attention?: ApplicationAttention | null;
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
  billingState:
    "not_connected" | "sandbox" | "active" | "past_due" | "cancelled";
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
