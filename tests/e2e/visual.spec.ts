import { expect, test } from "@playwright/test";

test("public homepage visual baseline", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Preview data - connect Supabase/i)).toBeVisible();
  await expect(page).toHaveScreenshot("homepage.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: false,
  });
});
