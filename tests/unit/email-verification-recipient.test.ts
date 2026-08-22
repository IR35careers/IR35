import { describe, expect, it } from "vitest";
import { applicationInboxAlias } from "@/lib/email/inbox-alias";
import { verificationRecipientMatches } from "@/lib/email/wait-for-verification-code";

const applicationId = "a2222222-2222-4222-8222-222222222222";
const baseAlias = "apply-cd774440a5bfb9@mail.ir35careers.com";
const taggedAlias = applicationInboxAlias(baseAlias, applicationId);

describe("verification email recipient routing", () => {
  it("matches the exact application address used by the employer", () => {
    expect(
      verificationRecipientMatches({
        actual: taggedAlias,
        expected: taggedAlias,
        applicationId,
      }),
    ).toBe(true);
  });

  it("accepts a tagged address when a legacy runner supplied the base alias", () => {
    expect(
      verificationRecipientMatches({
        actual: taggedAlias,
        expected: baseAlias,
        applicationId,
      }),
    ).toBe(true);
  });

  it("rejects a code addressed to another application", () => {
    expect(
      verificationRecipientMatches({
        actual: applicationInboxAlias(
          baseAlias,
          "b3333333-3333-4333-8333-333333333333",
        ),
        expected: taggedAlias,
        applicationId,
      }),
    ).toBe(false);
  });
});
