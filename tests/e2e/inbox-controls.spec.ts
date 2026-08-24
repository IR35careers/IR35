import { expect, test } from "@playwright/test";

async function dismissPrivacyNotice(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: "Understood", exact: true });
  if (await button.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) await button.click();
}

test("inbox connection state and message filters stay clear", async ({ page }) => {
  await page.goto("/inbox");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Your application messages" })).toBeVisible();
  await expect(page.getByText("Application email", { exact: true })).toBeVisible();
  await expect(page.getByText("alex.morgan@inbox.ir35careers.local", { exact: true })).toBeVisible();
  await expect(page.getByText("Your account email", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy email" })).toBeVisible();

  await page.getByRole("button", { name: "Rejection" }).click();
  await expect(page.getByRole("button", { name: "Rejection" })).toHaveAttribute("aria-pressed", "true");
  await page.getByPlaceholder("Search messages, companies or roles").fill("Northstar");
  await expect(page.getByText("No Rejection messages")).toBeVisible();
  await expect(page.getByRole("button", { name: "View all messages" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Compose" })).toHaveCount(0);
  await page.getByPlaceholder("Search messages, companies or roles").fill("");
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByRole("button", { name: /Availability for an initial contract discussion/ }).click();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reply to recruiter" })).toBeVisible();
  await expect(page.getByText("To talent@northstar.example.test", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close composer" }).click();
});
