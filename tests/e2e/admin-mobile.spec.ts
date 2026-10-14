import { expect, test } from "@playwright/test";

for (const width of [320, 390, 430]) {
test(`mobile admin navigation and support details stay within ${width}px`, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Phone-specific admin interactions");
  await page.setViewportSize({ width, height: 844 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  test.skip(!url, "Requires the public Supabase URL for the isolated client fixture");
  const project = new URL(url!).hostname.split(".")[0];
  const user = { id: "00000000-0000-4000-8000-000000000002", email: "info@ir35careers.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  // Synthetic browser-only identity. Every admin API is intercepted; no real
  // session, customer record, credential or backend permission is used.
  await page.addInitScript(({ project, user }) => {
    const encoded = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    window.localStorage.setItem(`sb-${project}-auth-token`, JSON.stringify({ access_token: `${encoded({ alg: "HS256" })}.${encoded({ sub: user.id, exp: expiry })}.test-signature`, refresh_token: "controlled-browser-only", token_type: "bearer", expires_at: expiry, expires_in: 3600, user }));
    window.localStorage.setItem("ir35careers:cookie-consent:v1", "essential");
  }, { project, user });
  await page.route("**/auth/v1/**", (route) => route.fulfill({ json: user }));
  await page.route("**/api/admin/session", (route) => route.fulfill({ json: { unlocked: true, role: "admin", expiresIn: 1200 } }));
  const contractor = {
    id: "controlled-contractor", email: "a-long-contractor-email-address-for-layout-testing@example.com",
    created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(),
    email_confirmed_at: new Date().toISOString(), provider: "google",
    profile: { full_name: "Alex Morgan Controlled Contractor", cv_filename: "fixture-resume.pdf", skills: ["Azure"] },
    activity: { applications: 7, savedJobs: 2, applied: 1, needsAttention: 0, resumeVersions: 0, alerts: 0, inboxMessages: 0, unreadMessages: 0 },
  };
  await page.route("**/api/admin?*", (route) => route.fulfill({ json: {
    users: [contractor], total: 140,
    contractor: { account: contractor, profile: contractor.profile, activity: contractor.activity, applications: [], resumeVersions: [], audit: [], resume: { filename: "fixture-resume.pdf", available: true, source: "uploaded" } },
    feedback: [{ id: "fixture-ticket", name: "Controlled Customer", email: "customer@example.com", company: "", subject: "Mobile support fixture", message: "A controlled long-message layout test for the mobile support conversation.", status: "new", category: "general", priority: "normal", created_at: new Date().toISOString(), messages: [] }],
    feedbackSummary: { total: 1, new: 1, inProgress: 0, resolved: 0, highPriority: 0, spam: 0 },
  } }));
  await page.route("**/api/admin", (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/admin?section=feedback");
  await page.getByRole("button", { name: "Unlock for 20 minutes" }).click();
  await expect(page.getByRole("heading", { name: "Customer feedback queue" })).toBeVisible();
  const essentialOnly = page.getByRole("button", { name: "Essential only", exact: true });
  if (await essentialOnly.isVisible()) await essentialOnly.click();
  await page.getByRole("button", { name: "Open admin navigation" }).click();
  const navigation = page.getByRole("dialog", { name: "Administrator navigation" });
  await expect(navigation).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Shift+Tab");
  await expect(navigation.getByRole("button", { name: "Lock admin and sign out" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: /IR35Careers/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open admin navigation" })).toBeFocused();
  await expect(navigation).toHaveCount(0);
  await page.getByRole("button", { name: /Mobile support fixture/ }).click();
  await expect(page.getByRole("button", { name: "Back to enquiries" })).toBeVisible();
  await expect(page.getByLabel("Reply to customer")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Back to enquiries" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `output/admin-mobile-support-${width}.png` });
  await page.getByRole("button", { name: "Back to enquiries" }).click();
  await expect(page.getByRole("button", { name: /Mobile support fixture/ })).toBeVisible();

  await page.getByRole("button", { name: "Open admin navigation" }).click();
  await page.getByRole("button", { name: "Contractors", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Contractors", exact: true })).toBeVisible();
  const cards = page.getByRole("list", { name: "Contractor accounts" });
  await expect(cards).toBeVisible();
  await expect(cards.getByText(contractor.email, { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).not.toBeVisible();
  const stats = page.locator(".ir35-admin-colour-grid > article");
  const first = await stats.nth(0).boundingBox();
  const second = await stats.nth(1).boundingBox();
  expect(first!.y).toBe(second!.y);
  expect(second!.x).toBeGreaterThan(first!.x);
  const main = await page.locator("main").boundingBox();
  expect(main!.width).toBe(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await cards.getByRole("button", { name: `View ${contractor.profile.full_name}` }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `output/admin-mobile-contractors-${width}.png` });
  await cards.getByRole("button", { name: `View ${contractor.profile.full_name}` }).click();
  await expect(page.getByRole("dialog", { name: contractor.profile.full_name })).toBeVisible();
  const record = page.getByRole("dialog", { name: contractor.profile.full_name });
  await expect(record.getByRole("button", { name: "Close contractor details", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await record.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await page.getByRole("tab", { name: /^resume$/i }).click();
  await expect(page.getByText("Original resume", { exact: true })).toBeVisible();
  await expect(record.getByRole("button", { name: "Download", exact: true })).toBeVisible();
  const tabs = record.getByRole("tablist");
  expect(await tabs.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await page.screenshot({ path: `output/admin-mobile-contractor-record-${width}.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: contractor.profile.full_name })).toHaveCount(0);
  await expect(cards.getByRole("button", { name: `View ${contractor.profile.full_name}` })).toBeFocused();
  await page.getByLabel("Search Contractors", { exact: true }).fill("no-matching-contractor");
  await expect(page.getByText("No matching contractors", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
});
}
