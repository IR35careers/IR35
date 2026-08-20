import type { ResumeScore } from "@/lib/resume/types";

export interface AiTailoringSuggestion {
  id: string;
  section: string;
  original: string;
  replacement: string;
  rationale: string;
  evidenceQuote: string;
  keywords: string[];
  impact: "high" | "medium" | "low";
}

export interface AiTailoringResult {
  model: string;
  summary: string;
  mustHaveRequirements: string[];
  niceToHaveRequirements: string[];
  suggestions: AiTailoringSuggestion[];
  coverLetter: string;
  baseline: ResumeScore;
  projected: ResumeScore;
  privacy: {
    directIdentifiersRedacted: true;
    zeroDataRetentionRequested: true;
    dataCollectionDenied: true;
  };
}
