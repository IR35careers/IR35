import { describe, expect, it } from "vitest";
import { applicationSubmissionFailure } from "@/lib/application-submission-failure";

describe("application submission failures", () => {
  it("turns infrastructure details into a safe retry message", () => {
    const failure = applicationSubmissionFailure(
      new Error("Invalid IP address: undefined"),
    );
    expect(failure.code).toBe("temporary_runner_error");
    expect(failure.message).toContain("temporary connection issue");
    expect(failure.message).not.toContain("undefined");
  });

  it("preserves the known employer-unavailable message", () => {
    expect(
      applicationSubmissionFailure(
        new Error("The employer application page is unavailable or closed."),
      ),
    ).toEqual({
      code: "employer_unavailable",
      message: "The employer application page is unavailable or closed.",
    });
  });
});
