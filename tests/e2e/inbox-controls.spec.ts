import { expect, test } from "@playwright/test";

test("inbox connection state and message filters stay clear", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Your application messages" })).toBeVisible();
  await expect(page.getByText("Application email identity", { exact: true })).toBeVisible();
  await expect(page.getByText("IR35Careers email", { exact: true })).toBeVisible();
  await expect(page.getByText("Your account email", { exact: true })).toBeVisible();
  await expect(page.getByText("alex.morgan@example.test", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy email" })).toBeVisible();

  await page.getByRole("button", { name: "Rejection" }).click();
  await expect(page.getByRole("button", { name: "Rejection" })).toHaveAttribute("aria-pressed", "true");
  await page.getByPlaceholder("Search messages, companies or roles").fill("Northstar");
  await expect(page.getByText("No messages in this view")).toBeVisible();

  await page.getByRole("button", { name: "Compose" }).click();
  await expect(page.getByRole("heading", { name: "New recruiter message" })).toBeVisible();
  await expect(page.getByText("From alex.morgan@inbox.ir35careers.local")).toBeVisible();
  await page.getByRole("button", { name: "Close composer" }).click();
});
