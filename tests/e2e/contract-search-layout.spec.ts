import { expect, test } from "@playwright/test";

test("contract search icons remain sharp above the input surface", async ({ page }, testInfo) => {
  await page.addInitScript(() => window.localStorage.setItem("ir35careers:cookie-consent:v1", "essential"));
  await page.route("**/api/jobs/search?*", (route) => route.fulfill({ json: {
    jobs: [], total: 0, page: 1, per_page: 12,
    facets: { inside: 0, outside: 0, tbc: 0, remote: 0, hybrid: 0, onsite: 0 },
  } }));
  await page.goto("/jobs?ir35=inside&sponsorship=stated");
  await expect(page.getByRole("heading", { name: "Find your next contract" })).toBeVisible();
  for (const name of ["Search contracts", "Filter by location"]) {
    const input = page.getByRole("searchbox", { name, exact: true });
    await expect(input).toBeVisible();
    expect(await input.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe("none");
    const icon = input.locator("..").locator("svg");
    await expect(icon).toBeVisible();
    expect(await icon.evaluate((element) => getComputedStyle(element).filter)).toBe("none");
    expect(await icon.evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `output/contract-search-${testInfo.project.name}.png` });
});
