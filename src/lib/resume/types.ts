import type { JobDetail } from "@/lib/job-types";

export type ResumeSectionKind =
  | "summary"
  | "skills"
  | "experience"
  | "education"
  | "certifications"
  | "projects"
  | "other";

export interface ResumeSection {
  kind: ResumeSectionKind;
  title: string;
  content: string;
}

export interface ParsedResume {
  filename: string;
  rawText: string;
  candidateName: string;
  contactLine: string;
  sections: ResumeSection[];
}

export interface RoleKeyword {
  term: string;
  source: "listed-skill" | "job-description";
  weight: number;
}

export interface ResumeScoreBreakdown {
  keywordCoverage: number;
  evidenceStrength: number;
  roleRelevance: number;
  atsReadability: number;
}

export interface ResumeScore {
  overall: number;
  breakdown: ResumeScoreBreakdown;
  matchedKeywords: string[];
  missingKeywords: string[];
}

export type ResumeSuggestionKind = "summary" | "rewrite" | "verified-keyword";

export interface ResumeSuggestion {
  id: string;
  kind: ResumeSuggestionKind;
  title: string;
  rationale: string;
  original: string;
  replacement: string;
  evidenceTerms: string[];
  requiresConfirmation: boolean;
}

export interface ResumeAnalysis {
  job: Pick<JobDetail, "id" | "title" | "company_name" | "description" | "skills">;
  keywords: RoleKeyword[];
  baseline: ResumeScore;
  projected: ResumeScore;
  suggestions: ResumeSuggestion[];
  defaultAcceptedIds: string[];
}

export type ResumeVersionStatus = "draft" | "approved";

export interface ResumeVersion {
  id: string;
  userId: string | null;
  jobId: string;
  jobTitle: string;
  companyName: string;
  sourceFilename: string;
  label: string;
  status: ResumeVersionStatus;
  sourceText: string;
  tailoredText: string;
  acceptedSuggestionIds: string[];
  confirmedKeywordIds: string[];
  score: ResumeScore;
  createdAt: string;
  approvedAt: string | null;
}

export interface ResumeExportRequest {
  format: "pdf" | "docx";
  resumeText: string;
  candidateName: string;
  jobTitle: string;
  companyName: string;
  versionLabel: string;
}
