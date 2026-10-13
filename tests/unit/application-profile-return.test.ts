import { describe, expect, it } from "vitest";
import {
  applicationProfileHref,
  safeApplicationReturnPath,
} from "@/lib/application-profile-return";

describe("application profile continuation", () => {
  it("returns to the exact saved application after profile completion", () => {
    const href = applicationProfileHref("role 123");
    expect(href).toBe(
      "/profile?returnTo=%2Fapplications%2Fnew%2Frole%2520123%3Fresume%3Dprofile%23needs-attention#application-readiness",
    );
    expect(
      safeApplicationReturnPath(
        "/applications/new/role%20123?resume=profile#needs-attention",
      ),
    ).toBe(
      "/applications/new/role%20123?resume=profile#needs-attention",
    );
  });

  it("links directly to the missing profile answer", () => {
    expect(applicationProfileHref("role 123", "over-18")).toBe(
      "/profile?returnTo=%2Fapplications%2Fnew%2Frole%2520123%3Fresume%3Dprofile%23needs-attention&focus=over-18#application-readiness",
    );
  });

  it("rejects external and unrelated return destinations", () => {
    expect(safeApplicationReturnPath("https://example.com/applications/new/1"))
      .toBeUndefined();
    expect(safeApplicationReturnPath("//example.com/applications/new/1"))
      .toBeUndefined();
    expect(safeApplicationReturnPath("/profile"))
      .toBeUndefined();
    expect(
      safeApplicationReturnPath(
        "/applications/new/1?resume=anything#needs-attention",
      ),
    ).toBeUndefined();
  });
});
