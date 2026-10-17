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
  await expect(page.locator("h1")).toHaveCount(1);
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

test("tools have their own search metadata and classic favicon", async ({ page, request }) => {
  for (const [path, title] of [
    ["/tools/ir35-status", "IR35 Status Checker"],
    ["/tools/take-home", "Take-Home Pay Calculator"],
    ["/analyse-job", "Contract Job Analyser"],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://www.ir35careers.com${path}`);
    expect((await page.title()).length).toBeLessThanOrEqual(60);
    expect(await page.locator('meta[name="description"]').getAttribute("content")).not.toContain("Resumes");
  }
  const favicon = await request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect((await favicon.body()).subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  const dashboard = await request.get("/dashboard");
  expect(dashboard.headers()["x-robots-tag"]).toContain("noindex");
  expect(dashboard.headers()["x-powered-by"]).toBeUndefined();
  expect(await dashboard.text()).toContain('name="robots" content="noindex');
});
