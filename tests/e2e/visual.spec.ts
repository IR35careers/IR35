import { expect, test } from "@playwright/test";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";

test("public homepage visual baseline", async ({ page }) => {
  await page.route("**/api/jobs/search?per_page=4", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobs: DEMO_JOBS.slice(0, 4),
        total: DEMO_JOBS.length,
        page: 1,
        per_page: 4,
        data_source: "demo",
        generated_at: "2026-08-20T09:00:00.000Z",
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByText(/Preview roles are shown in this local workspace/i)).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page).toHaveScreenshot("homepage.png", {
    animations: "disabled",
    caret: "initial",
    fullPage: false,
    maxDiffPixels: 20,
  });
});
