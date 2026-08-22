import { describe, expect, it } from "vitest";
import { classifyFeedback, feedbackSummary, prioritiseFeedback, type FeedbackRecord } from "@/lib/admin-feedback";

describe("admin feedback intelligence", () => {
  it("classifies common customer requests", () => {
    expect(classifyFeedback("My application is blocked after CV tailoring")).toBe("application");
    expect(classifyFeedback("This expired job listing still appears")).toBe("job_listing");
    expect(classifyFeedback("I cannot sign in to my account")).toBe("account");
    expect(classifyFeedback("The contrast is difficult for screen reader users")).toBe("accessibility");
  });

  it("raises blocked and overdue open enquiries", () => {
    const now = Date.parse("2026-08-22T10:00:00Z");
    expect(prioritiseFeedback("I am unable to apply", "new", "2026-08-22T09:00:00Z", now)).toBe("high");
    expect(prioritiseFeedback("Please add a filter", "new", "2026-08-19T09:00:00Z", now)).toBe("high");
    expect(prioritiseFeedback("I am unable to apply", "resolved", "2026-08-22T09:00:00Z", now)).toBe("normal");
  });

  it("summarises the operational queue", () => {
    const base = { name: "Alex", email: "alex@example.org", company: "", message: "Help", created_at: "2026-08-22T09:00:00Z", category: "general" as const };
    const records: FeedbackRecord[] = [
      { ...base, id: "1", status: "new", priority: "high" },
      { ...base, id: "2", status: "in_progress", priority: "normal" },
      { ...base, id: "3", status: "resolved", priority: "normal" },
    ];
    expect(feedbackSummary(records)).toEqual({ total: 3, new: 1, inProgress: 1, resolved: 1, highPriority: 1 });
  });
});
