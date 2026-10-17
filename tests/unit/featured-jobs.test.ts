import { describe, expect, it } from "vitest";
import { selectFeaturedJobs } from "@/lib/featured-jobs";
import type { JobListing } from "@/lib/job-types";

function job(id: string, status: JobListing["ir35_status"]): JobListing {
  return {
    id,
    title: `Role ${id}`,
    company_name: "Example",
    location: "London",
    remote_type: "hybrid",
    ir35_status: status,
    ir35_confidence: status === "unknown" ? "low" : "high",
    rate_min: 500,
    rate_max: 600,
    rate_currency: "GBP",
    rate_type: "daily",
    skills: [],
    posted_at: "2026-08-26T09:00:00.000Z",
    first_seen_at: "2026-08-26T09:00:00.000Z",
  };
}

describe("homepage featured jobs", () => {
  it("removes TBC roles and includes both confirmed statuses", () => {
    const selected = selectFeaturedJobs([
      job("unknown-1", "unknown"),
      job("outside-1", "outside"),
      job("outside-2", "outside"),
      job("inside-1", "inside"),
    ]);

    expect(selected).toHaveLength(3);
    expect(selected.map((item) => item.id)).not.toContain("unknown-1");
    expect(selected.map((item) => item.ir35_status)).toContain("inside");
    expect(selected.map((item) => item.ir35_status)).toContain("outside");
  });

  it("preserves source freshness order", () => {
    const selected = selectFeaturedJobs([
      job("inside-1", "inside"),
      job("outside-1", "outside"),
      job("inside-2", "inside"),
    ]);

    expect(selected.map((item) => item.id)).toEqual(["inside-1", "outside-1", "inside-2"]);
  });
});
