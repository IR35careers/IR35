import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function dismissPrivacyNotice(page: Page) {
  const button = page.getByRole("button", { name: "Essential only", exact: true });
  if (await button.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) await button.click();
}

test("isolated preview reports unavailable Google honestly, never silently redirects or contacts Google", async ({ page }, testInfo) => {
  let identityRequests = 0;
  await page.route("https://accounts.google.com/**", route => { identityRequests++; return route.abort(); });
  await page.route("**/auth/v1/**", route => { identityRequests++; return route.abort(); });
  const response = await page.goto("/account?next=%2Fapplications");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("status").filter({ hasText: "Google sign-in is unavailable here. Use email." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use Google redirect fallback", exact: true })).toHaveCount(0);
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("frame-src 'self' https://accounts.google.com/gsi/");
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toContain("*.google.com");
  await page.getByLabel("Email address", { exact: true }).fill("controlled@example.test");
  await page.getByLabel("Password", { exact: true }).fill("controlled-preview-password");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("couldn't sign you in");
  expect(identityRequests).toBe(0);
  await expect(page).toHaveURL(/\/account\?next=%2Fapplications$/);
  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations.filter(item => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  const capture = testInfo.outputPath("google-offline-safe.png");
  await page.screenshot({ path: capture, fullPage: true });
  await testInfo.attach("Google offline preview boundary", { path: capture, contentType: "image/png" });
});

test("signup Google entry respects legal consent and direct redirect endpoint remains disabled", async ({ page }) => {
  const response = await page.request.get("/api/auth/google?next=%2Fdashboard");
  expect(response.status()).toBe(404);
  expect(response.headers()["location"]).toBeUndefined();
  await page.goto("/account?mode=create");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("status").filter({ hasText: "Accept the terms above" })).toBeVisible();
  await page.getByRole("checkbox", { name: /I agree to the Terms of Use/ }).check();
  await expect(page.getByRole("status").filter({ hasText: "Google sign-in is unavailable here. Use email." })).toBeVisible();
  await page.getByRole("checkbox", { name: /I agree to the Terms of Use/ }).uncheck();
  await expect(page.getByRole("status").filter({ hasText: "Accept the terms above" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use Google redirect fallback", exact: true })).toHaveCount(0);
});
