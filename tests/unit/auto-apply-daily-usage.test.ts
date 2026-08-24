import { describe, expect, it } from "vitest";
import { submissionCountsTowardsDailyLimit } from "@/lib/automation/daily-usage";

describe("Auto Apply daily usage", () => {
  it("counts active and confirmed submissions", () => {
    expect(submissionCountsTowardsDailyLimit("queued")).toBe(true);
    expect(submissionCountsTowardsDailyLimit("processing")).toBe(true);
    expect(submissionCountsTowardsDailyLimit("succeeded")).toBe(true);
  });

  it("does not charge failed or cancelled attempts", () => {
    expect(submissionCountsTowardsDailyLimit("failed")).toBe(false);
    expect(submissionCountsTowardsDailyLimit("cancelled")).toBe(false);
  });
});
