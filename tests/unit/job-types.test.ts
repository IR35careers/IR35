import { describe, expect, it, vi } from "vitest";
import { formatPosted, formatRate, ir35EvidenceLabel, type JobListing } from "@/lib/job-types";

const base = {
  rate_min: null,
  rate_max: null,
  rate_currency: "GBP",
  rate_type: "daily",
} satisfies Pick<JobListing, "rate_min" | "rate_max" | "rate_currency" | "rate_type">;

describe("formatRate", () => {
  it("formats daily ranges and single values", () => {
    expect(formatRate({ ...base, rate_min: 550, rate_max: 650 })).toBe("£550-£650/day");
    expect(formatRate({ ...base, rate_min: 600, rate_max: 600 })).toBe("£600/day");
  });

  it("does not invent a rate", () => {
    expect(formatRate(base)).toBe("Rate on application");
  });

  it("formats annual and upper-bound values", () => {
    expect(formatRate({ ...base, rate_type: "annual", rate_min: 80_000, rate_max: 95_000 })).toBe("£80k-£95k/yr");
    expect(formatRate({ ...base, rate_min: null, rate_max: 700 })).toBe("Up to £700/day");
  });
});

describe("IR35 evidence", () => {
  it("maps only explicit evidence to confident labels", () => {
    expect(ir35EvidenceLabel({ ir35_status: "outside", ir35_confidence: "high" })).toBe("Status stated in the job title");
    expect(ir35EvidenceLabel({ ir35_status: "inside", ir35_confidence: "medium" })).toBe("Status stated in the listing");
    expect(ir35EvidenceLabel({ ir35_status: "unknown", ir35_confidence: "low" })).toBe("No explicit status found");
  });
});

describe("formatPosted", () => {
  it("uses the best available date and stable relative labels", () => {
    vi.setSystemTime(new Date("2026-08-19T12:00:00Z"));
    expect(formatPosted({ posted_at: "2026-08-19T08:00:00Z", first_seen_at: "2026-08-18T08:00:00Z" })).toBe("Today");
    expect(formatPosted({ posted_at: null, first_seen_at: "2026-08-18T08:00:00Z" })).toBe("Yesterday");
    expect(formatPosted({ posted_at: "2026-08-05T08:00:00Z", first_seen_at: "2026-08-05T08:00:00Z" })).toBe("2 weeks ago");
    vi.useRealTimers();
  });
});
