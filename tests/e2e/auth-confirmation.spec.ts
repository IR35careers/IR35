import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createSeedWorkspaceState } from "../../src/lib/workspace/seed";

const jobId = "11111111-1111-4111-8111-111111111111";
const next = `/applications/new/${jobId}?applicationId=00000000-0000-4000-8000-000000000009#final-application-approval`;

async function dismissPrivacyNotice(page: Page) {
  const button = page.getByRole("button", { name: "Essential only", exact: true });
  if (await button.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) await button.click();
}

test("expired confirmation has explicit safe resend, cleans credentials and retains the actual selected job", async ({ page }, testInfo) => {
  let authRequests = 0;
  await page.route("**/auth/v1/**", route => { authRequests++; return route.abort(); });
  const response = await page.goto(`/auth/callback?next=${encodeURIComponent(next)}#error=access_denied&error_code=otp_expired&error_description=untrusted-provider-secret`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "This confirmation link has expired" })).toBeVisible();
  await expect(page).not.toHaveURL(/untrusted-provider-secret|otp_expired|access_denied/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(next);
  await expect(page.locator("main")).not.toContainText("untrusted-provider-secret");
  expect(authRequests).toBe(0); // Opening a link must not send another email.
  await page.getByLabel("Account email address", { exact: true }).fill("controlled@example.test");
  await page.getByRole("button", { name: "Resend confirmation email", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("unavailable in this local preview");
  await expect(page.getByRole("button", { name: "Resend confirmation email", exact: true })).toBeDisabled();
  await expect(page.locator("main")).not.toContainText("a new link has been requested");
  const scan = await new AxeBuilder({ page }).include("main").analyze();
  expect(scan.violations.filter(item => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  const capture = testInfo.outputPath("expired-confirmation.png");
  await page.screenshot({ path: capture, fullPage: true });
  await testInfo.attach("expired-confirmation", { path: capture, contentType: "image/png" });
  await page.getByRole("link", { name: "Return to sign in", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sign in to apply to" })).toContainText("Senior DevOps Engineer - Outside IR35");
  await expect(page.getByRole("status").filter({ hasText: "Sign in to apply to" })).toContainText("Northstar Digital");
  expect(new URL(page.url()).searchParams.get("next")).toBe(next);
  expect(authRequests).toBe(0);
});

test("invalid callback cannot redirect outside the site or display spoofed job facts", async ({ page }) => {
  await page.goto("/auth/callback?next=https%3A%2F%2Fevil.example%2Fdashboard&error_description=spoofed-secret");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "This sign-in link could not be verified" })).toBeVisible();
  await expect(page).not.toHaveURL(/evil.example|spoofed-secret/);
  await page.getByRole("link", { name: "Return to sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account\?next=%2Fdashboard$/);
  await page.goto(`/account?next=${encodeURIComponent(next)}&title=Fake%20Director&company=Spoofed`);
  await expect(page.getByRole("status").filter({ hasText: "Sign in to apply to" })).toContainText("Northstar Digital");
  await expect(page.locator("main")).not.toContainText("Fake Director");
  await expect(page.locator("main")).not.toContainText("Spoofed");
});

test("Apply settings opens directly even before the first CV upload", async ({ page }) => {
  const state = structuredClone(createSeedWorkspaceState());
  state.profile.resumeProfiles = [];
  state.profile.activeResumeProfileId = undefined;
  state.profile.profileSetupCompletedAt = undefined;
  state.profile.defaultCvLabel = "";
  state.applications = [];
  await page.addInitScript(workspace => {
    localStorage.setItem("ir35careers.workspace.v1", JSON.stringify(workspace));
    localStorage.setItem("ir35careers:dashboard-tour:v2:local-preview", "complete");
  }, state);
  await page.goto("/profile#apply-settings");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Application mode", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with your resume", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Resume optimisation", exact: true })).toBeVisible();
});
