export type FeedbackStatus = "new" | "in_progress" | "resolved" | "spam";
export type FeedbackCategory = "application" | "job_listing" | "account" | "billing" | "accessibility" | "general";
export type FeedbackPriority = "high" | "normal";
export const SUPPORT_ONLINE_WINDOW_MS = 90_000;

export type SupportPresence = {
  online: boolean;
  lastActiveAt: string | null;
};

export type FeedbackRecord = {
  id: string;
  user_id?: string | null;
  name: string;
  email: string;
  company: string;
  subject?: string;
  message: string;
  status: FeedbackStatus;
  created_at: string;
  updated_at?: string;
  page_url?: string;
  browser_context?: string;
  attachment_path?: string | null;
  attachment_url?: string | null;
  resolution_summary?: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
  messages?: FeedbackMessage[];
  category: FeedbackCategory;
  priority?: FeedbackPriority;
};

export type FeedbackMessage = {
  id: string;
  feedback_id: string;
  author_type: "customer" | "admin" | "system";
  author_user_id?: string | null;
  author_email: string;
  message: string;
  attachment_path?: string | null;
  attachment_url?: string | null;
  created_at: string;
  read_by_user_at?: string | null;
};

export function classifyFeedback(message: string): FeedbackCategory {
  const value = message.toLowerCase();
  if (/accessib|screen reader|keyboard|contrast|disabilit/.test(value)) return "accessibility";
  if (/payment|billing|subscription|refund|charged|price|plan/.test(value)) return "billing";
  if (/sign[ -]?in|log[ -]?in|account|profile|password|verification/.test(value)) return "account";
  if (/apply|application|resume|\bcv\b|tailor|interview|recruiter/.test(value)) return "application";
  if (/\bjob\b|listing|contract|role|expired|duplicate|search result/.test(value)) return "job_listing";
  return "general";
}

export function prioritiseFeedback(message: string, status: FeedbackStatus, createdAt: string, now = Date.now()): FeedbackPriority {
  if (status === "resolved" || status === "spam") return "normal";
  const value = message.toLowerCase();
  const age = now - new Date(createdAt).getTime();
  const urgentLanguage = /cannot|can't|unable|blocked|urgent|security|privacy|charged|payment failed|data breach/.test(value);
  return urgentLanguage || age >= 48 * 60 * 60 * 1000 ? "high" : "normal";
}

export function enrichFeedback<Row extends Omit<FeedbackRecord, "priority">>(row: Row, now = Date.now()): FeedbackRecord {
  return {
    ...row,
    category: row.category || classifyFeedback(row.message),
    priority: prioritiseFeedback(row.message, row.status, row.created_at, now),
  };
}

export function feedbackSummary(records: FeedbackRecord[]) {
  return {
    total: records.length,
    new: records.filter((record) => record.status === "new").length,
    inProgress: records.filter((record) => record.status === "in_progress").length,
    resolved: records.filter((record) => record.status === "resolved").length,
    highPriority: records.filter((record) => record.priority === "high").length,
  };
}

export function supportPresence(lastActiveAt: string | null | undefined, now = Date.now()): SupportPresence {
  if (!lastActiveAt) return { online: false, lastActiveAt: null };
  const activeAt = new Date(lastActiveAt).getTime();
  if (!Number.isFinite(activeAt)) return { online: false, lastActiveAt: null };
  return {
    online: now - activeAt <= SUPPORT_ONLINE_WINDOW_MS,
    lastActiveAt,
  };
}
