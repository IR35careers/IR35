import { describe, expect, it } from "vitest";
import {
  applicationProfileHref,
  safeApplicationReturnPath,
} from "@/lib/application-profile-return";

describe("application profile continuation", () => {
  it("returns to the exact saved application after profile completion", () => {
    const href = applicationProfileHref("role 123");
    expect(href).toBe(
      "/profile?returnTo=%2Fapplications%2Fnew%2Frole%2520123%23needs-attention#application-readiness",
    );
    expect(
      safeApplicationReturnPath(
        "/applications/new/role%20123#needs-attention",
      ),
    ).toBe("/applications/new/role%20123#needs-attention");
  });

  it("rejects external and unrelated return destinations", () => {
    expect(safeApplicationReturnPath("https://example.com/applications/new/1"))
      .toBeUndefined();
    expect(safeApplicationReturnPath("//example.com/applications/new/1"))
      .toBeUndefined();
    expect(safeApplicationReturnPath("/profile"))
      .toBeUndefined();
  });
});
