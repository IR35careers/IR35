import { describe, expect, it } from "vitest";
import { submissionAttentionFromRow } from "@/lib/workspace/submission-attention";

describe("workspace submission attention", () => {
  it("prefers the exact worker attention stored in the queue receipt", () => {
    const attention = submissionAttentionFromRow({
      status: "processing",
      error_code: "needs_user",
      receipt: {
        attention: {
          kind: "employer_account",
          title: "Employer account needs attention",
          message: "Sign in to the employer account, then continue.",
          action: "#needs-attention",
          actionLabel: "Resolve sign in",
          questionIds: [],
        },
      },
    });

    expect(attention).toMatchObject({
      kind: "employer_account",
      title: "Employer sign-in is required",
      action: "#employer-account-access",
      actionLabel: "Review account step",
    });
  });

  it("rebuilds a precise action from older needs-user receipts", () => {
    const attention = submissionAttentionFromRow({
      status: "processing",
      error_code: "needs_user",
      receipt: {
        action: "employer_login",
        message: "The employer rejected the automatic account sign-in.",
      },
    });

    expect(attention).toMatchObject({
      kind: "employer_account",
      title: "Employer sign-in is required",
      action: "#employer-account-access",
      actionLabel: "Review account step",
      message: "The employer rejected the automatic account sign-in.",
    });
  });

  it("restores missing question highlights from the stored provider review", () => {
    const attention = submissionAttentionFromRow({
      status: "processing",
      error_code: "needs_user",
      receipt: {
        action: "browser_continue",
        message: "The employer needs one answer.",
        attention: {
          kind: "employer_form",
          title: "Application paused before confirmation",
          message: "The employer needs one answer.",
          action: "#needs-attention",
          actionLabel: "Retry application",
          questionIds: [],
        },
        review: {
          questions: [
            {
              id: "security-clearance",
              label: "What security clearance do you hold?",
              required: true,
            },
          ],
        },
      },
    });

    expect(attention).toMatchObject({
      kind: "employer_form",
      actionLabel: "Answer question",
      questionIds: ["provider:security-clearance"],
    });
  });

  it("does not turn successful or cancelled submissions into attention", () => {
    expect(
      submissionAttentionFromRow({
        status: "succeeded",
        error_code: null,
        receipt: { message: "Application submitted" },
      }),
    ).toBeNull();
    expect(
      submissionAttentionFromRow({
        status: "cancelled",
        error_code: "listing_unavailable",
        receipt: { action: "listing_unavailable" },
      }),
    ).toBeNull();
  });
});
