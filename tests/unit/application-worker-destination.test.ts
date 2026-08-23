import { describe, expect, it } from "vitest";
import { resolveApplicationTaskDestination } from "@/lib/application-worker-destination";

describe("resolveApplicationTaskDestination", () => {
  it("resumes at the final employer portal after a discovery-board handoff", () => {
    expect(
      resolveApplicationTaskDestination({
        taskDestination: "https://www.adzuna.co.uk/details/123",
        receiptDestination:
          "https://www.totaljobs.com/job/abc/application/smart-apply",
      }),
    ).toBe("https://www.totaljobs.com/job/abc/application/smart-apply");
  });

  it("keeps the original approved destination when no handoff was recorded", () => {
    expect(
      resolveApplicationTaskDestination({
        taskDestination: "https://www.reed.co.uk/jobs/platform-engineer/123",
      }),
    ).toBe("https://www.reed.co.uk/jobs/platform-engineer/123");
  });

  it("rejects an unapproved receipt destination", () => {
    expect(
      resolveApplicationTaskDestination({
        taskDestination: "https://www.adzuna.co.uk/details/123",
        receiptDestination: "https://attacker.example/collect",
      }),
    ).toBe("https://www.adzuna.co.uk/details/123");
  });
});
