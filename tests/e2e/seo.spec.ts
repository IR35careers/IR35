import { expect, test } from "@playwright/test";

test("public search identity is canonical and private pages are excluded", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://www.ir35careers.com"
  );
  const structuredData = await page.locator('script[type="application/ld+json"]').textContent();
  expect(structuredData).toContain('"@type":"WebSite"');
  expect(structuredData).toContain('"name":"IR35Careers"');
  expect(structuredData).toContain('"@type":"Organization"');

  await page.goto("/jobs");
  await expect(page).toHaveTitle("UK Contract Jobs: Inside & Outside IR35 | IR35Careers");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://www.ir35careers.com/jobs"
  );

  const account = await request.get("/account");
  expect(account.headers()["x-robots-tag"]).toContain("noindex");

  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap: https://www.ir35careers.com/sitemap.xml");

  const sitemap = await request.get("/sitemap.xml");
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain("<loc>https://www.ir35careers.com/</loc>");
  expect(sitemapText).not.toContain("<loc>https://ir35careers.com/");
});
