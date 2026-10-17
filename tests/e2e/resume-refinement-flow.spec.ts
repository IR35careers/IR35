import { expect, test } from "@playwright/test";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";

const jobId = "11111111-1111-4111-8111-111111111111";
test("unrecognised requirements do not become a made-up score or zero evidence gaps", async ({ page }) => {
  await page.route("**/api/jobs/preview", (route) => route.fulfill({ json: { job: {
    ...DEMO_JOBS[0], title: "Interim Financial Controller", skills: [],
    description: "Produce statutory accounts and balance sheet reconciliations for the business.",
    apply_url: "https://employer.example.test/controller",
  } } }));
  await page.goto("/analyse-job");
  await page.getByLabel("Public job URL").fill("https://employer.example.test/controller");
  await page.getByRole("button", { name: "Analyse job", exact: true }).click();
  await page.getByRole("button", { name: "Tailor CV locally" }).click();
  await page.getByRole("button", { name: "Try the labelled sample Resume" }).click();
  await page.getByRole("button", { name: "Analyse against this role" }).click();
  await expect(page.getByText("Not scored", { exact: true })).toBeVisible();
  await expect(page.getByText("Review JD", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use selected draft" }).click();
  await expect(page.getByText("Match score withheld", { exact: true })).toBeVisible();
});

test("a reviewed resume transfers exactly into the application and can be refined again", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("ir35careers:cookie-consent:v1", "essential");
    window.localStorage.setItem("ir35careers:dashboard-tour:v2:local-preview", "complete");
  });
  let submissionRequests = 0;
  await page.route("**/api/applications/submit", (route) => { submissionRequests += 1; return route.fulfill({ status: 503, json: { error: "Controlled test: no external application is sent." } }); });
  await page.goto(`/jobs/${jobId}/resume`);
  const privacy = page.getByRole("button", { name: "Essential only", exact: true });
  if (await privacy.isVisible()) await privacy.click();
  await page.getByLabel("Resume text", { exact: true }).fill(`Alex Morgan\nalex.morgan@example.test\n\nPROFILE\nContract technology specialist with cloud platform delivery experience.\n\nSKILLS\nGit, AWS, Terraform, Linux\n\nEXPERIENCE\n- I was responsible for improving AWS platform reliability across production services.\n- I worked on Terraform components for engineering teams.\n- Reduced recurring deployment failures by 28%.`);
  await page.getByRole("button", { name: "Analyse against this role" }).click();
  await expect(page.getByRole("heading", { name: "Choose the changes you want" })).toBeVisible();
  const accept = page.getByRole("button", { name: /^Accept change / }).first();
  await accept.click();
  await page.getByLabel("Suggested wording 1").fill("Contract technology specialist delivering AWS platform improvements for UK programmes.");
  await page.screenshot({ path: `output/resume-refinement-review-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Use selected draft" }).click();
  const editor = page.getByLabel("Resume text", { exact: true });
  if (testInfo.project.name === "mobile-chrome") expect(await editor.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(editor).toHaveValue(/Contract technology specialist delivering AWS/);
  await page.getByRole("button", { name: "Approve & save version" }).click();
  const apply = page.getByRole("link", { name: "Review & apply with this resume" });
  await expect(apply).toBeVisible();
  await editor.fill(`${await editor.inputValue()}\nSupported a human-reviewed operational handover.`);
  await expect(apply).toHaveCount(0);
  await page.getByRole("button", { name: "Approve & save version" }).click();
  const selectedText = await editor.inputValue();
  await expect(apply).toBeVisible();
  await apply.click();
  await page.waitForURL("**/applications/new/**", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Senior DevOps Engineer - Outside IR35", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Edit Resume", exact: true }).click();
  await expect(page.getByLabel("Resume text", { exact: true })).toHaveValue(selectedText);
  const packet = await page.evaluate((id) => {
    const workspace = JSON.parse(window.localStorage.getItem("ir35careers.workspace.v1") || "{}");
    return workspace.applications?.find((item: { job: { id: string } }) => item.job.id === id);
  }, jobId);
  expect(packet.tailoredCvText).toBe(selectedText);
  expect(packet.sourceCvText).not.toContain("human-reviewed operational handover");
  expect(packet.truthApproved).toBe(false);
  expect(packet.materialsApproved).toBe(false);
  expect(packet.submissionApproved).toBe(false);
  await page.getByRole("button", { name: "Refine for this job" }).click();
  await page.getByText("Add real experience that is missing (optional)", { exact: true }).click();
  await page.getByLabel("Additional factual experience").fill("Supported a Kubernetes sandbox migration for an internal platform project in 2024.");
  const useVersion = page.getByRole("button", { name: "Use this version & review application" });
  await expect(useVersion).toBeDisabled();
  await page.getByRole("checkbox", { name: /confirm this additional experience/ }).check();
  await expect(useVersion).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await useVersion.click();
  await expect(page.getByText("Employer questions", { exact: true })).toBeVisible();
  expect(submissionRequests).toBe(0);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Edit Resume", exact: true }).click();
  await expect(page.getByLabel("Resume text", { exact: true })).toHaveValue(/ADDITIONAL EXPERIENCE/);
});
