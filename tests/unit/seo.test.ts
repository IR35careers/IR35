import { describe, expect, it } from "vitest";
import { buildHomeStructuredData, SITE_NAME, SITE_ORIGIN } from "@/lib/seo";

describe("search identity", () => {
  it("uses the redirected www domain as the single canonical origin", () => {
    expect(SITE_ORIGIN).toBe("https://www.ir35careers.com");
  });

  it("provides Google with a consistent website and organisation identity", () => {
    const [website, organisation] = buildHomeStructuredData();

    expect(website).toMatchObject({
      "@type": "WebSite",
      url: `${SITE_ORIGIN}/`,
      name: SITE_NAME,
      alternateName: expect.arrayContaining(["IR35 Careers", "ir35careers.com"]),
    });
    expect(organisation).toMatchObject({
      "@type": "Organization",
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
    });
    expect(JSON.stringify([website, organisation])).not.toContain("kxcbgflleqnjzjbkevwd");
  });
});
