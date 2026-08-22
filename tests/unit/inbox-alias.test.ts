import { describe, expect, it } from "vitest";
import {
  applicationInboxAlias,
  parseApplicationInboxAlias,
} from "@/lib/email/inbox-alias";

describe("application-scoped inbox aliases", () => {
  const applicationId = "22222222-2222-4222-8222-222222222222";

  it("routes an employer address back to the base mailbox and application", () => {
    const address = applicationInboxAlias(
      "apply-abc123@mail.ir35careers.com",
      applicationId,
    );
    expect(address).toBe(
      "apply-abc123-a22222222222242228222222222222222@mail.ir35careers.com",
    );
    expect(parseApplicationInboxAlias(address)).toEqual({
      baseAlias: "apply-abc123@mail.ir35careers.com",
      applicationId,
    });
  });

  it("leaves a normal private mailbox unchanged", () => {
    expect(
      parseApplicationInboxAlias("apply-abc123@mail.ir35careers.com"),
    ).toEqual({ baseAlias: "apply-abc123@mail.ir35careers.com" });
  });
});
