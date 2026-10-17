import { describe, expect, it } from "vitest";
import { classifyAdminApplicationRun } from "@/lib/admin/application-run-status";

describe("admin application run status", () => {
  it("keeps closed listings separate from worker failures", () => {
    expect(
      classifyAdminApplicationRun({
        status: "cancelled",
        errorCode: "listing_unavailable",
        action: "listing_unavailable",
      }),
    ).toBe("unavailable");
    expect(
      classifyAdminApplicationRun({
        status: "failed",
        errorCode: "worker_failed",
        action: null,
      }),
    ).toBe("failed");
  });

  it("reports user actions and confirmations accurately", () => {
    expect(
      classifyAdminApplicationRun({
        status: "failed",
        errorCode: "needs_user",
        action: "employer_terms",
      }),
    ).toBe("needs_action");
    expect(
      classifyAdminApplicationRun({
        status: "succeeded",
        errorCode: null,
        action: null,
      }),
    ).toBe("confirmed");
  });
});
