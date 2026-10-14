import { expect, test } from "@playwright/test";

test("mobile admin navigation and support details stay within the viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Phone-specific admin interactions");
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
  await page.route("**/api/admin?*", (route) => route.fulfill({ json: {
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
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open admin navigation" })).toBeFocused();
  await expect(navigation).toHaveCount(0);
  await page.getByRole("button", { name: /Mobile support fixture/ }).click();
  await expect(page.getByRole("button", { name: "Back to enquiries" })).toBeVisible();
  await expect(page.getByLabel("Reply to customer")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Back to enquiries" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "output/admin-mobile-support.png" });
  await page.getByRole("button", { name: "Back to enquiries" }).click();
  await expect(page.getByRole("button", { name: /Mobile support fixture/ })).toBeVisible();
});
