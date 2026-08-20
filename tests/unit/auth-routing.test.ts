import { describe, expect, it } from "vitest";
import { resolvePostAuthPath } from "@/lib/auth-routing";

describe("post-auth routing", () => {
  it("sends generic and public destinations to the dashboard", () => {
    expect(resolvePostAuthPath(null)).toBe("/dashboard");
    expect(resolvePostAuthPath("/")).toBe("/dashboard");
    expect(resolvePostAuthPath("/jobs")).toBe("/dashboard");
    expect(resolvePostAuthPath("/privacy")).toBe("/dashboard");
  });

  it("preserves explicit workspace and contract-detail intents", () => {
    expect(resolvePostAuthPath("/applications/new/role-1")).toBe("/applications/new/role-1");
    expect(resolvePostAuthPath("/jobs/role-1?from=saved")).toBe("/jobs/role-1?from=saved");
    expect(resolvePostAuthPath("/admin")).toBe("/admin");
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(resolvePostAuthPath("https://malicious.example/dashboard")).toBe("/dashboard");
    expect(resolvePostAuthPath("//malicious.example/dashboard")).toBe("/dashboard");
  });
});
