import { describe, expect, it } from "vitest";
import { validatePublicHttpsUrl } from "@/lib/security/public-url";

describe("public HTTPS URL validation", () => {
  it.each([
    "https://127.0.0.1/private",
    "https://10.0.0.1/private",
    "https://169.254.169.254/latest/meta-data",
    "https://192.0.2.1/documentation",
    "https://[::1]/private",
    "https://[::ffff:7f00:1]/mapped-loopback",
    "https://[64:ff9b:1::1]/local-nat64",
    "https://[100::1]/discard-only",
    "https://[2001:db8::1]/documentation",
    "https://[ff02::1]/multicast",
  ])("blocks non-public address %s", async (url) => {
    await expect(validatePublicHttpsUrl(url)).rejects.toThrow(/public website/);
  });

  it("accepts a literal public HTTPS address", async () => {
    await expect(validatePublicHttpsUrl("https://1.1.1.1/jobs")).resolves.toMatchObject({ protocol: "https:" });
  });

  it("rejects credentials and non-standard ports", async () => {
    await expect(validatePublicHttpsUrl("https://user:pass@1.1.1.1/jobs")).rejects.toThrow(/without embedded credentials/);
    await expect(validatePublicHttpsUrl("https://1.1.1.1:8443/jobs")).rejects.toThrow(/without embedded credentials/);
  });
});
