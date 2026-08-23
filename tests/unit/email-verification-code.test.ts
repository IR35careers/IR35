import { describe, expect, it } from "vitest";
import { extractEmailVerificationCode } from "@/lib/email/verification-code";

describe("email verification codes", () => {
  it("extracts a contextual numeric or mixed code", () => {
    expect(
      extractEmailVerificationCode(
        "Verify your email",
        "Your verification code is 482193. It expires in ten minutes.",
      ),
    ).toBe("482193");
    expect(
      extractEmailVerificationCode(
        "Security code",
        "Use A7F42Q to continue your application.",
      ),
    ).toBe("A7F42Q");
    expect(
      extractEmailVerificationCode(
        "Email verification",
        "Your code is 184205",
      ),
    ).toBe("184205");
  });

  it("does not treat unrelated numbers or words as a code", () => {
    expect(
      extractEmailVerificationCode(
        "Application update",
        "Your application number is 482193.",
      ),
    ).toBeNull();
    expect(
      extractEmailVerificationCode(
        "Verify your email",
        "Select VERIFY to continue.",
      ),
    ).toBeNull();
  });
});
