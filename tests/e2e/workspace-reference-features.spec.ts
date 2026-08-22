import { expect, test } from "@playwright/test";

async function dismissPrivacyNotice(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: "Understood", exact: true });
  if (await button.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) await button.click();
}

test("profile keeps reusable identity, resume, cover letter and application controls together", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Your professional profile" })).toBeVisible();
  await expect(page.getByLabel("Full name")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add profile" })).toBeVisible();
  await expect(page.getByText("Application readiness", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Employer portal automation" })).toBeVisible();
  await expect(page.getByLabel("Are you willing to travel for work?")).toBeVisible();
  await expect(page.getByLabel("Target annual salary")).toBeVisible();

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resume studio" })).toBeVisible();
  await expect(page.getByLabel("Template")).toBeVisible();
  await expect(page.getByLabel("Font")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit to one page" })).toBeVisible();

  await page.getByRole("button", { name: "Cover letter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cover letter" })).toBeVisible();
  await expect(page.getByLabel("Letter text")).toBeVisible();

  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resume optimisation" })).toBeVisible();
  await expect(page.getByText("Use my private application email", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test("research library ranks practical topics and identifies every source", async ({ page }) => {
  await page.goto("/research");
  await expect(page.getByRole("heading", { name: "Evidence for better contract decisions" })).toBeVisible();
  await expect(page.getByText("6 reviewed topics")).toBeVisible();
  await expect(page.getByText("Source: HMRC guidance")).toBeVisible();
  await expect(page.getByText("Source: HMRC contractor facts")).toBeVisible();
  await expect(page.getByText("Source: IR35Careers methodology")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open status checker/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test("incomplete application profiles show the exact next action", async ({ page }) => {
  await page.goto("/applications/new/11111111-1111-4111-8111-111111111111");
  await dismissPrivacyNotice(page);
  await expect(
    page.getByRole("heading", {
      name: "Complete your reusable profile before applying",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Complete profile" })).toHaveAttribute(
    "href",
    "/profile#application-readiness",
  );
  await expect(page.getByRole("button", { name: "Prepare application" })).toBeDisabled();
});
