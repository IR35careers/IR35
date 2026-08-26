import { describe, expect, it } from "vitest";
import { resolveApplicationProgressPhase } from "@/lib/application-progress";

const base = {
  submitted: false,
  busy: false,
  submissionInProgress: false,
  hasAttention: false,
  hasError: false,
  elapsedSeconds: 0,
};

describe("application progress dialog state", () => {
  it("moves from preparation to the employer form without showing a fake failure", () => {
    expect(resolveApplicationProgressPhase({ ...base, busy: true })).toBe("preparing");
    expect(
      resolveApplicationProgressPhase({ ...base, busy: true, elapsedSeconds: 3 }),
    ).toBe("applying");
    expect(
      resolveApplicationProgressPhase({ ...base, submissionInProgress: true }),
    ).toBe("applying");
  });

  it("prioritises verified success over stale processing state", () => {
    expect(
      resolveApplicationProgressPhase({
        ...base,
        submitted: true,
        submissionInProgress: true,
      }),
    ).toBe("success");
  });

  it("shows action and retry outcomes only after active processing stops", () => {
    expect(resolveApplicationProgressPhase({ ...base, hasAttention: true })).toBe(
      "attention",
    );
    expect(resolveApplicationProgressPhase({ ...base, hasError: true })).toBe(
      "error",
    );
  });
});
