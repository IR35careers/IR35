import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailReceivedEvent, GetReceivingEmailResponseSuccess } from "resend";
import { extractEmailAddress, htmlToPlainText, normaliseResendEmail, resendInboundConfig } from "@/lib/email/resend";

afterEach(() => vi.unstubAllEnvs());

describe("Resend inbound adapter", () => {
  it("requires valid server-only provider credentials", () => {
    vi.stubEnv("RESEND_API_KEY", "not-an-api-key");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "not-a-webhook-secret");
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "mail.ir35careers.com");
    expect(resendInboundConfig()).toBeNull();

    vi.stubEnv("RESEND_API_KEY", "re_test-key");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test-secret");
    expect(resendInboundConfig()).toEqual({
      apiKey: "re_test-key",
      webhookSecret: "whsec_test-secret",
      domain: "mail.ir35careers.com",
    });
  });

  it("extracts safe plain text without retaining executable HTML", () => {
    expect(htmlToPlainText("<style>body{color:red}</style><p>Hello &amp; welcome</p><script>alert(1)</script><p>Interview tomorrow</p>"))
      .toBe("Hello & welcome\nInterview tomorrow");
    expect(extractEmailAddress("Recruiter <Recruiter@Example.COM>")).toBe("recruiter@example.com");
  });

  it("normalises a received event and keeps only the configured inbound domain", () => {
    const event: EmailReceivedEvent = {
      type: "email.received",
      created_at: "2026-08-20T15:00:00.000Z",
      data: {
        email_id: "56761188-7520-42d8-849b-ff6fc54ce618",
        created_at: "2026-08-20T15:00:00.000Z",
        from: "Recruiter <recruiter@example.com>",
        to: ["apply-123@mail.ir35careers.com", "ignored@example.com"],
        received_for: ["apply-123@mail.ir35careers.com"],
        bcc: [],
        cc: [],
        message_id: "<message@example.com>",
        subject: "Interview availability",
        attachments: [],
      },
    };
    const email: GetReceivingEmailResponseSuccess = {
      object: "email",
      id: event.data.email_id,
      to: event.data.to,
      from: event.data.from,
      created_at: event.data.created_at,
      subject: event.data.subject,
      bcc: [],
      cc: [],
      reply_to: [],
      received_for: event.data.received_for,
      html: "<p>Please book a call.</p>",
      text: null,
      headers: {},
      message_id: event.data.message_id,
      attachments: [],
    };

    expect(normaliseResendEmail(event, email, "mail.ir35careers.com")).toMatchObject({
      providerMessageId: `resend:${event.data.email_id}`,
      recipients: ["apply-123@mail.ir35careers.com"],
      sender: "Recruiter <recruiter@example.com>",
      subject: "Interview availability",
      text: "Please book a call.",
      receivedAt: "2026-08-20T15:00:00.000Z",
    });
  });
});
