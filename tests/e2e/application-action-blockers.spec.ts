import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prepareApplication } from "../../src/lib/workspace/engine";
import { createSeedWorkspaceState, SAMPLE_CV_TEXT } from "../../src/lib/workspace/seed";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";

async function dismissPrivacyNotice(page: Page) {
  const button = page.getByRole("button", { name: "Essential only", exact: true });
  const visible = await button.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false);
  if (visible) await button.click();
}

async function seed(page: Page, missingCv = false) {
  const state = structuredClone(createSeedWorkspaceState());
  const application = prepareApplication({ job: DEMO_JOBS[0], profile: state.profile, cvText: SAMPLE_CV_TEXT });
  state.applications = [{ ...application, id: "00000000-0000-4000-8000-000000000008", deliveryStatus: "awaiting_approval", deliveryVersion: 1,
    tailoredCvText: missingCv ? "Short CV" : application.tailoredCvText,
    questions: [
      { id: "aws-delivery", label: "Describe your AWS delivery", answer: "", reviewed: false, required: true, source: "profile" },
      { id: "azure-delivery", label: "Describe your Azure delivery", answer: "AKS delivery.", reviewed: false, required: true, source: "profile" },
    ], truthApproved: false, materialsApproved: false, submissionApproved: false }];
  state.profile.phone = "";
  // These details are not required just to return to this saved application.
  state.profile.willingToTravel = null;
  state.profile.backgroundCheckConsent = null;
  state.profile.applicationPreferences = { resumeOptimisation: "honest", autoApproveSafeEdits: true,
    reviewBeforeSubmit: true, generateCoverLetter: true, usePrivateApplicationEmail: true,
    ...state.profile.applicationPreferences, autoApplyEnabled: false,
    autoApplyConsentAt: undefined, autoApplyConsentVersion: undefined };
  let requests = 0;
  await page.route("**/api/applications/submit", route => { requests++; return route.abort(); });
  await page.route("**/api/automation/apply-next", route => { requests++; return route.abort(); });
  await page.addInitScript(workspace => {
    if (!localStorage.getItem("ir35careers.workspace.v1")) localStorage.setItem("ir35careers.workspace.v1", JSON.stringify(workspace));
    localStorage.setItem("ir35careers:dashboard-tour:v2:local-preview", "complete");
  }, state);
  return { url: `/applications/new/${application.job.id}?applicationId=${state.applications[0].id}`, requests: () => requests };
}

test("Submit explains every missing fact and focuses the exact remedy without a completion-percentage gate", async ({ page }, testInfo) => {
  const fixture = await seed(page);
  await page.goto(fixture.url);
  await dismissPrivacyNotice(page);
  const reasons = page.getByRole("region", { name: "Before you can submit", exact: true });
  const submit = page.getByRole("button", { name: "Submit application", exact: true });
  await expect(submit).toBeDisabled();
  await expect(reasons.getByRole("listitem")).toHaveCount(4);
  await expect(reasons).toContainText("Add your phone number.");
  await expect(reasons).toContainText("Answer “Describe your AWS delivery”.");
  await expect(reasons).toContainText("Confirm your answer to “Describe your Azure delivery”.");
  await expect(reasons).toContainText("Approve this application");
  const screenshot = testInfo.outputPath("application-blockers.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("application-blockers", { path: screenshot, contentType: "image/png" });
  const scan = await new AxeBuilder({ page }).include("#application-submit-reasons").analyze();
  expect(scan.violations.filter(item => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  await reasons.getByRole("button", { name: "Review answer", exact: true }).first().click();
  await expect(page.locator("#question-aws-delivery")).toBeFocused();
  await page.locator("#question-aws-delivery").fill("Delivered AWS infrastructure using Terraform.");
  await reasons.getByRole("button", { name: "Review answer", exact: true }).click();
  await expect(page.locator("#question-azure-delivery")).toBeFocused();
  await page.locator("#question-azure-delivery").fill("Delivered Azure Kubernetes Service with monitoring.");
  await expect(reasons.getByRole("listitem")).toHaveCount(2);
  await reasons.getByRole("button", { name: "Review final approval" }).click();
  await expect(page.getByRole("checkbox", { name: /Approve this application/ })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(reasons.getByRole("listitem")).toHaveCount(1);
  await expect(submit).toBeDisabled();

  await reasons.getByRole("link", { name: "Add phone number", exact: true }).click();
  await expect(page.locator("#profile-field-phone")).toBeFocused();
  await page.locator("#profile-field-phone").fill("+447700900123");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ready for applications", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Application record" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Before you can submit", exact: true })).toHaveCount(0);
  await expect(submit).toBeEnabled();
  expect(fixture.requests()).toBe(0);
});

test("a short application CV links to the actual application editor, not an unrelated profile upload", async ({ page }) => {
  const fixture = await seed(page, true);
  await page.goto(fixture.url);
  await dismissPrivacyNotice(page);
  const reasons = page.getByRole("region", { name: "Before you can submit", exact: true });
  await expect(reasons).toContainText("Add a readable CV with at least 120 characters.");
  await reasons.getByRole("button", { name: "Review application CV", exact: true }).click();
  const editor = page.getByLabel("Resume text", { exact: true });
  await expect(editor).toBeFocused();
  await editor.fill(SAMPLE_CV_TEXT);
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await expect(reasons).not.toContainText("Add a readable CV");
  await expect(page.getByRole("button", { name: "Submit application", exact: true })).toBeDisabled();
  expect(fixture.requests()).toBe(0);
});

test("Auto Apply explains paused and consent gates and routes to the actual controls", async ({ page }, testInfo) => {
  const fixture = await seed(page);
  await page.goto("/automation");
  await dismissPrivacyNotice(page);
  await page.getByRole("button", { name: "Permission", exact: true }).click();
  const reasons = page.getByRole("region", { name: "Before Auto Apply can start", exact: true });
  const apply = page.getByRole("button", { name: "Apply to next match now", exact: true });
  await expect(apply).toBeDisabled();
  await expect(reasons.getByRole("listitem")).toHaveCount(2);
  const screenshot = testInfo.outputPath("automation-blockers.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("automation-blockers", { path: screenshot, contentType: "image/png" });
  const scan = await new AxeBuilder({ page }).include("#auto-apply-reasons").analyze();
  expect(scan.violations.filter(item => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  await reasons.getByRole("button", { name: "Open Auto Apply switch" }).click();
  const toggle = page.getByRole("switch");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole("button", { name: "Permission", exact: true }).click();
  await expect(reasons.getByRole("listitem")).toHaveCount(1);
  await reasons.getByRole("button", { name: "Review permission" }).click();
  const consent = page.locator("#auto-apply-consent");
  await expect(consent).toBeFocused();
  await page.keyboard.press("Space");
  await expect(reasons).toHaveCount(0);
  await expect(apply).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(apply).toBeDisabled();
  await expect(reasons.getByRole("listitem")).toHaveCount(1);
  expect(fixture.requests()).toBe(0);
});
