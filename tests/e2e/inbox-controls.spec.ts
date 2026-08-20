import { expect, test } from "@playwright/test";

test("inbox connection state and message filters stay clear", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Responses linked to the right role" })).toBeVisible();
  await expect(page.getByText("Private application address", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy address" })).toBeVisible();

  await page.getByRole("button", { name: "Rejections" }).click();
  await expect(page.getByRole("button", { name: "Rejections" })).toHaveAttribute("aria-pressed", "true");
});
