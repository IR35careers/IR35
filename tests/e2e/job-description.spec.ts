import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";
import { prepareApplication } from "../../src/lib/workspace/engine";
import { createSeedWorkspaceState, SAMPLE_CV_TEXT } from "../../src/lib/workspace/seed";

test.use({ hasTouch: true });
const original = "https://careers.example.test/contract/controlled";

async function dismissPrivacy(page: Page) {
  const essential = page.getByRole("button", { name: "Essential only", exact: true });
  if (await essential.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) await essential.click();
}
async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
async function checkDescriptionA11y(page: Page) {
  const result = await new AxeBuilder({ page }).include("[data-job-description]").analyze();
  expect(result.violations.filter(item => ["critical", "serious"].includes(item.impact ?? ""))).toEqual([]);
}

test("long source text has its final paragraph, wraps long tokens and expands with native touch/keyboard", async ({ page }, testInfo) => {
  const description = `Source introduction.\n\n${"A complete paragraph of contractor responsibilities.\n".repeat(35)}\n${"LongUnbrokenToken".repeat(70)}\n\nFinal paragraph: controlled source end marker.`;
  await page.route("**/api/jobs/preview", route => route.fulfill({ json: { job: { ...DEMO_JOBS[0], description,
    description_kind: "source_text", source_domain: "careers.example.test", apply_url: original } } }));
  await page.goto("/analyse-job"); await dismissPrivacy(page);
  await page.getByLabel("Public job URL").fill(original);
  await page.getByRole("button", { name: "Analyse job", exact: true }).click();
  const body = page.locator('[data-job-description="source_text"]');
  const text = body.locator("div").first();
  await expect(text).toHaveText(description);
  await expect(text).toContainText("controlled source end marker.");
  expect(await text.evaluate(element => {
    const style = getComputedStyle(element);
    return { maxHeight: style.maxHeight, overflow: style.overflowY, wraps: style.overflowWrap };
  })).toEqual({ maxHeight: "none", overflow: "visible", wraps: "anywhere" });
  await expectNoOverflow(page);
  const summary = page.locator("article summary");
  await summary.tap(); await expect(body).toBeHidden();
  await summary.focus(); await page.keyboard.press("Enter"); await expect(body).toBeVisible();
  await page.keyboard.press("Space"); await expect(body).toBeHidden();
  await page.keyboard.press("Enter"); await expect(body).toBeVisible();
  const link = body.getByRole("link", { name: "View original posting" });
  await expect(link).toHaveAttribute("href", original);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await link.scrollIntoViewIfNeeded(); await expect(link).toBeInViewport();
  await checkDescriptionA11y(page);
  await summary.scrollIntoViewIfNeeded();
  const capture = testInfo.outputPath("source-description-expanded.png");
  await page.screenshot({ path: capture });
  await testInfo.attach("source-description-expanded", { path: capture, contentType: "image/png" });
});

test("known excerpts, missing text and limited imports remain honest and do not execute advertiser HTML", async ({ page }) => {
  let kind = "summary";
  let description = "An excerpt ending in a full stop. <img src=x onerror=alert(1)>";
  await page.route("**/api/jobs/preview", route => route.fulfill({ json: { job: { ...DEMO_JOBS[0], description,
    description_kind: kind, source_domain: "careers.example.test", apply_url: original } } }));
  await page.goto("/analyse-job"); await dismissPrivacy(page);
  await page.getByLabel("Public job URL").fill(original);
  await page.getByRole("button", { name: "Analyse job", exact: true }).click();
  const body = page.locator("[data-job-description]");
  await expect(body).toHaveAttribute("data-job-description", "summary");
  await expect(body).toContainText("not a confirmed full advert");
  await expect(body.locator("img,script")).toHaveCount(0);
  await expect(body).not.toContainText("shown in full");
  await checkDescriptionA11y(page); await expectNoOverflow(page);
  kind = "missing"; description = "";
  await page.getByRole("button", { name: "Analyse job", exact: true }).click();
  await expect(body).toHaveAttribute("data-job-description", "missing");
  await expect(body).toContainText("did not provide readable description text");
  kind = "limited"; description = "Only complete words retained…";
  await page.getByRole("button", { name: "Analyse job", exact: true }).click();
  await expect(body).toHaveAttribute("data-job-description", "limited");
  await expect(body).toContainText("exceeded the safe import limit");
  await checkDescriptionA11y(page);
});

test("public and saved-application views preserve the final source sentence after tabs and reload", async ({ page }) => {
  const state = createSeedWorkspaceState();
  const application = { ...prepareApplication({ job: DEMO_JOBS[0], profile: state.profile, cvText: SAMPLE_CV_TEXT }),
    id: "00000000-0000-4000-8000-000000000010", deliveryStatus: "awaiting_approval" as const, deliveryVersion: 1 };
  state.applications = [application];
  let submits = 0;
  await page.route("**/api/applications/submit", route => { submits++; return route.abort(); });
  await page.addInitScript(workspace => {
    if (!localStorage.getItem("ir35careers.workspace.v1")) localStorage.setItem("ir35careers.workspace.v1", JSON.stringify(workspace));
    localStorage.setItem("ir35careers:dashboard-tour:v2:local-preview", "complete");
  }, state);
  await page.goto(`/jobs/${DEMO_JOBS[0].id}`); await dismissPrivacy(page);
  const body = page.locator("[data-job-description]");
  await expect(body).toContainText("Hybrid working in London two days per week.");
  await expectNoOverflow(page); await checkDescriptionA11y(page);
  await page.goto(`/applications/new/${application.job.id}?applicationId=${application.id}`);
  await page.getByRole("button", { name: "Contract", exact: true }).click();
  await expect(body).toContainText("Hybrid working in London two days per week.");
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await page.getByRole("button", { name: "Contract", exact: true }).click();
  await expect(body).toContainText("Hybrid working in London two days per week.");
  await page.reload();
  await page.getByRole("button", { name: "Contract", exact: true }).click();
  await expect(body).toContainText("Hybrid working in London two days per week.");
  await expectNoOverflow(page); await checkDescriptionA11y(page);
  expect(submits).toBe(0);
});

test("application preparation keeps a touch/keyboard disclosure and the role-details action", async ({ page }) => {
  const state = createSeedWorkspaceState(); state.applications = [];
  await page.addInitScript(workspace => {
    if (!localStorage.getItem("ir35careers.workspace.v1")) localStorage.setItem("ir35careers.workspace.v1", JSON.stringify(workspace));
    localStorage.setItem("ir35careers:dashboard-tour:v2:local-preview", "complete");
  }, state);
  await page.goto(`/applications/new/${DEMO_JOBS[0].id}`); await dismissPrivacy(page);
  const summary = page.locator("summary").filter({ hasText: "Contract description" });
  const body = page.locator("[data-job-description]");
  await expect(body).toContainText("Hybrid working in London two days per week.");
  await summary.tap(); await expect(body).toBeHidden();
  await summary.focus(); await page.keyboard.press("Space"); await expect(body).toBeVisible();
  await expect(page.getByRole("link", { name: "Open role details" })).toHaveAttribute("href", `/jobs/${DEMO_JOBS[0].id}`);
  await expectNoOverflow(page); await checkDescriptionA11y(page);
});
