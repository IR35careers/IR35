import { describe, expect, it, vi } from "vitest";
import type { Resend } from "resend";
import { findResendVerificationEmail } from "@/lib/email/resend-verification-sync";

function mockResend(input: {
  listed: Array<Record<string, unknown>>;
  received?: Record<string, unknown>;
}): Resend {
  return {
    emails: {
      receiving: {
        list: vi.fn().mockResolvedValue({
          data: { data: input.listed, has_more: false, object: "list" },
          error: null,
        }),
        get: vi.fn().mockResolvedValue({
          data: input.received,
          error: input.received ? null : { message: "missing" },
        }),
      },
    },
  } as unknown as Resend;
}

describe("Resend verification fallback", () => {
  it("retrieves a matching verification email when the webhook is delayed", async () => {
    const applicationId = "18d69078-bb2c-48ac-bfea-d06cb956536e";
    const alias = `apply-user+${applicationId}@mail.ir35careers.com`;
    const resend = mockResend({
      listed: [
        {
          id: "email-1",
          to: [alias],
          received_for: [alias],
          created_at: "2026-08-23T01:00:30.000Z",
        },
      ],
      received: {
        id: "email-1",
        to: [alias],
        received_for: [alias],
        from: "Employer <accounts@example.com>",
        subject: "Verify your email",
        text: "Your verification code is 482913",
        html: null,
        created_at: "2026-08-23T01:00:30.000Z",
      },
    });

    const result = await findResendVerificationEmail({
      resend,
      userId: "8dbf2337-6f1c-42c3-8f98-b1a967d52b6a",
      applicationId,
      alias,
      requestedAfter: "2026-08-23T01:00:00.000Z",
    });

    expect(result?.code).toBe("482913");
    expect(result?.providerMessageId).toBe("resend:email-1");
  });

  it("ignores messages for another application alias", async () => {
    const applicationId = "18d69078-bb2c-48ac-bfea-d06cb956536e";
    const alias = `apply-user+${applicationId}@mail.ir35careers.com`;
    const resend = mockResend({
      listed: [
        {
          id: "email-2",
          to: [
            "apply-user+5014e5b2-8355-4684-b082-052d448999c8@mail.ir35careers.com",
          ],
          received_for: [],
          created_at: "2026-08-23T01:00:30.000Z",
        },
      ],
    });

    const result = await findResendVerificationEmail({
      resend,
      userId: "8dbf2337-6f1c-42c3-8f98-b1a967d52b6a",
      applicationId,
      alias,
      requestedAfter: "2026-08-23T01:00:00.000Z",
    });

    expect(result).toBeNull();
  });
});
