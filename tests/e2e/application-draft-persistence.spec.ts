import { expect, test } from "@playwright/test";
import { prepareApplication } from "../../src/lib/workspace/engine";
import { createSeedWorkspaceState, SAMPLE_CV_TEXT } from "../../src/lib/workspace/seed";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";

test("answers and material edits survive each application tab and a preview reload", async ({ page }) => {
  const state = createSeedWorkspaceState();
  const application = { ...prepareApplication({ job: DEMO_JOBS[0], profile: state.profile, cvText: SAMPLE_CV_TEXT }),
    id: "00000000-0000-4000-8000-000000000006", deliveryStatus: "awaiting_approval" as const, deliveryVersion: 1 };
  state.applications = [application];
  let submissionRequests = 0;
  await page.route("**/api/applications/submit", route => { submissionRequests++; return route.abort(); });
  await page.addInitScript(workspace => {
    if (!localStorage.getItem("ir35careers.workspace.v1")) localStorage.setItem("ir35careers.workspace.v1", JSON.stringify(workspace));
    localStorage.setItem("ir35careers:cookie-consent:v1", "essential");
    localStorage.setItem("ir35careers:dashboard-tour:v2:local-preview", "complete");
  }, state);
  await page.goto(`/applications/new/${application.job.id}?applicationId=${application.id}`);
  const availability = page.locator("#question-availability");
  const notice = page.locator("#question-notice-period");
  await expect(availability).toBeVisible();
  await availability.fill("Four weeks after contract approval.");
  await notice.fill("One calendar month.");
  for (const tab of ["Resume", "Cover letter", "Contract"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await page.getByRole("button", { name: "Form", exact: true }).click();
    await expect(availability).toHaveValue("Four weeks after contract approval.");
    await expect(notice).toHaveValue("One calendar month.");
  }
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Edit Resume", exact: true }).click();
  const updatedCv = `${application.tailoredCvText}\nReviewed platform delivery evidence for this application.`;
  await page.getByLabel("Resume text", { exact: true }).fill(updatedCv);
  await page.getByRole("button", { name: "Cover letter", exact: true }).click();
  await page.getByRole("button", { name: "Edit letter", exact: true }).click();
  const letter = "Dear hiring team,\n\nPlease review the delivery evidence in my application.\n\nKind regards,\nAlex Morgan";
  await page.getByLabel("Cover letter", { exact: true }).fill(letter);
  await page.getByRole("button", { name: "Contract", exact: true }).click();
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await expect(availability).toHaveValue("Four weeks after contract approval.");
  await expect(notice).toHaveValue("One calendar month.");
  await page.reload();
  await expect(availability).toHaveValue("Four weeks after contract approval.");
  await expect(notice).toHaveValue("One calendar month.");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Edit Resume", exact: true }).click();
  await expect(page.getByLabel("Resume text", { exact: true })).toHaveValue(updatedCv);
  await page.getByRole("button", { name: "Cover letter", exact: true }).click();
  await page.getByRole("button", { name: "Edit letter", exact: true }).click();
  await expect(page.getByLabel("Cover letter", { exact: true })).toHaveValue(letter);
  expect(submissionRequests).toBe(0);
});
