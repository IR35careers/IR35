import { describe, expect, it } from "vitest";
import { needsApplicationMaterialApproval } from "@/lib/application-material-approval";
import type { ApplicationQuestion } from "@/lib/workspace/types";

function question(
  overrides: Partial<ApplicationQuestion> = {},
): ApplicationQuestion {
  return {
    id: "notice-period",
    label: "What is your notice period?",
    answer: "Two weeks",
    required: true,
    source: "profile",
    reviewed: true,
    ...overrides,
  };
}

describe("application material approval", () => {
  it("preserves the prior submission instruction after profile completion", () => {
    expect(needsApplicationMaterialApproval([question()])).toBe(false);
  });

  it("requires another review only when a required employer answer is new", () => {
    expect(
      needsApplicationMaterialApproval([question({ reviewed: false })]),
    ).toBe(true);
    expect(
      needsApplicationMaterialApproval([
        question({ required: false, reviewed: false }),
      ]),
    ).toBe(false);
  });
});
