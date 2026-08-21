import { describe, expect, it } from "vitest";
import { buildSourceHealthSummary } from "@/lib/source-health";

describe("public source health", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("groups public observations and reports all-fresh health", () => {
    const summary = buildSourceHealthSummary([
      { source_domain: "reed.co.uk", last_seen_at: "2026-08-20T08:00:00.000Z" },
      { source_domain: "reed.co.uk", last_seen_at: "2026-08-19T08:00:00.000Z" },
      { source_domain: "jobs.lever.co", last_seen_at: "2026-08-18T12:00:00.000Z" },
    ], { now });
    expect(summary.status).toBe("healthy");
    expect(summary.activeJobs).toBe(3);
    expect(summary.sourceCount).toBe(2);
    expect(summary.freshJobs).toBe(3);
    expect(summary.freshPercent).toBe(100);
    expect(summary.sources[0]).toMatchObject({ domain: "reed.co.uk", label: "Reed", activeJobs: 2, freshJobs: 2, freshPercent: 100, freshness: "fresh" });
  });

  it("separates delayed and stale sources from fresh ones", () => {
    const summary = buildSourceHealthSummary([
      { source_domain: "reed.co.uk", last_seen_at: "2026-08-20T08:00:00.000Z" },
      { source_domain: "adzuna.co.uk", last_seen_at: "2026-08-15T08:00:00.000Z" },
      { source_domain: "jobs.example.com", last_seen_at: "2026-08-09T08:00:00.000Z" },
    ], { now });
    expect(summary.status).toBe("mixed");
    expect(summary.sources.find((source) => source.domain === "adzuna.co.uk")?.freshness).toBe("delayed");
    expect(summary.sources.find((source) => source.domain === "jobs.example.com")?.freshness).toBe("stale");
  });

  it("fails honestly when no usable observation time exists", () => {
    const summary = buildSourceHealthSummary([
      { source_domain: null, last_seen_at: null },
      { source_domain: "jobs.example.com", last_seen_at: "not-a-date" },
    ], { now });
    expect(summary.status).toBe("unavailable");
    expect(summary.latestObservedAt).toBeNull();
  });

  it("does not call an entire source fresh from one newly observed listing", () => {
    const rows = [
      { source_domain: "reed.co.uk", last_seen_at: "2026-08-20T08:00:00.000Z" },
      ...Array.from({ length: 9 }, () => ({
        source_domain: "reed.co.uk",
        last_seen_at: "2026-08-15T08:00:00.000Z",
      })),
    ];
    const summary = buildSourceHealthSummary(rows, { now });
    expect(summary.status).toBe("mixed");
    expect(summary.sources[0]).toMatchObject({
      activeJobs: 10,
      freshJobs: 1,
      freshPercent: 10,
      freshness: "delayed",
    });
  });
});
