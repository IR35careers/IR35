import { describe, expect, it } from "vitest";
import { isVerifiedRecruiterRecipient, normaliseReplySubject, recruiterReplyIdempotencyKey } from "@/lib/email/recruiter-reply";

describe("secure recruiter replies", () => {
  it("normalises reply subjects without allowing header controls", () => {
    expect(normaliseReplySubject("Re: RE: Interview\r\nBcc: victim@example.com"))
      .toBe("Re: Interview Bcc: victim@example.com");
  });

  it("uses a stable opaque provider idempotency key", () => {
    const first = recruiterReplyIdempotencyKey("user-1", "message-1", "request-1");
    expect(first).toBe(recruiterReplyIdempotencyKey("user-1", "message-1", "request-1"));
    expect(first).not.toContain("user-1");
    expect(first).not.toBe(recruiterReplyIdempotencyKey("user-1", "message-1", "request-2"));
  });

  it("permits replies only to the independently verified recruitment address", () => {
    expect(isVerifiedRecruiterRecipient("Recruiter <jobs@example.co.uk>", "jobs@example.co.uk")).toBe(true);
    expect(isVerifiedRecruiterRecipient("attacker@example.net", "jobs@example.co.uk")).toBe(false);
    expect(isVerifiedRecruiterRecipient("jobs@example.co.uk", null)).toBe(false);
  });
});
