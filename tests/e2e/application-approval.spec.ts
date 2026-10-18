import { expect, test, type Page } from "@playwright/test";
import { prepareApplication } from "../../src/lib/workspace/engine";
import { createSeedWorkspaceState, SAMPLE_CV_TEXT } from "../../src/lib/workspace/seed";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";

// Exercise native touch as well as pointer and keyboard on each viewport.
test.use({ hasTouch: true });

async function expectStoredApproval(page: Page, expected: boolean) {
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("ir35careers.workspace.v1") || "{}");
    const application = state.applications?.find((item: { id: string }) => item.id === "00000000-0000-4000-8000-000000000007");
    return [application?.truthApproved, application?.materialsApproved, application?.submissionApproved];
  })).toEqual([expected, expected, expected]);
}

test("final approval uses native pointer, label, touch and keyboard changes exactly once", async ({ page }, testInfo) => {
  const state = createSeedWorkspaceState();
  const application = prepareApplication({ job: DEMO_JOBS[0], profile: state.profile, cvText: SAMPLE_CV_TEXT });
  state.applications = [{ ...application, id: "00000000-0000-4000-8000-000000000007",
    deliveryStatus: "awaiting_approval", deliveryVersion: 1,
    questions: application.questions.map(question => ({ ...question, answer: question.answer || "Controlled fixture answer.", reviewed: true })),
    truthApproved: false, materialsApproved: false, submissionApproved: false }];
  let submissionRequests = 0;
  await page.route("**/api/applications/submit", route => { submissionRequests++; return route.abort(); });
  await page.addInitScript(workspace => {
    if (!localStorage.getItem("ir35careers.workspace.v1")) localStorage.setItem("ir35careers.workspace.v1", JSON.stringify(workspace));
    localStorage.setItem("ir35careers:cookie-consent:v1", "essential");
    localStorage.setItem("ir35careers:dashboard-tour:v2:local-preview", "complete");
  }, state);
  await page.goto(`/applications/new/${application.job.id}?applicationId=${state.applications[0].id}`);
  const approval = page.getByRole("checkbox", { name: /Approve this application/ });
  const submit = page.getByRole("button", { name: "Submit application", exact: true });
  await expect(approval).not.toBeChecked();
  await expect(submit).toBeDisabled();
  // click() targets the input itself; check() could conceal a broken toggle.
  await approval.click();
  await expect(approval).toBeChecked();
  await expectStoredApproval(page, true);
  await expect(submit).toBeEnabled();
  await page.getByText("Approve this application", { exact: true }).click();
  await expect(approval).not.toBeChecked();
  await expectStoredApproval(page, false);
  await expect(submit).toBeDisabled();
  await approval.tap();
  await expect(approval).toBeChecked();
  await expectStoredApproval(page, true);
  await approval.tap();
  await expect(approval).not.toBeChecked();
  await expectStoredApproval(page, false);

  // Reach the checkbox through normal tab order, not only programmatic focus.
  await page.locator('[id^="question-"]').last().focus();
  await page.keyboard.press("Tab");
  await expect(approval).toBeFocused();
  await page.keyboard.press("Space");
  await expect(approval).toBeChecked();
  await expectStoredApproval(page, true);
  await page.keyboard.press("Space");
  await expect(approval).not.toBeChecked();
  await expectStoredApproval(page, false);
  await page.keyboard.press("Space");
  await expect(approval).toBeChecked();
  await expectStoredApproval(page, true);
  await testInfo.attach("native-approval-control", { body: await page.screenshot(), contentType: "image/png" });
  await page.reload();
  await expect(approval).toBeChecked();
  await expectStoredApproval(page, true);

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Edit Resume", exact: true }).click();
  await page.getByLabel("Resume text", { exact: true }).fill(`${application.tailoredCvText}\nControlled edit after approval.`);
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await expect(approval).not.toBeChecked();
  await expectStoredApproval(page, false);
  await expect(submit).toBeDisabled();
  expect(submissionRequests).toBe(0);
});
