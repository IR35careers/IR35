import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function expectNoSeriousA11yViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .exclude("[data-nextjs-toast]")
    .exclude("nextjs-portal")
    .analyze();
  const serious = results.violations.filter((violation) =>
    violation.impact === "critical" || violation.impact === "serious"
  );
  expect(serious, serious.map((item) => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
}

test("public search-to-detail journey is usable and truthful", async ({ page, request }) => {
  const response = await request.get("/api/jobs/search?q=DevOps&with_facets=1");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.data_source).toBe("demo");
  expect(payload.jobs).toHaveLength(1);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Contract work, without the IR35 guesswork/i })).toBeVisible();
  await expect(page.getByText(/Preview data - connect Supabase/i)).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);

  await page.goto("/jobs");
  await expect(page.getByText("6 contracts found")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search contracts" }).fill("DevOps");
  await expect(page.getByText("1 contracts found")).toBeVisible();
  await page.getByRole("link", { name: /Senior DevOps Engineer - Outside IR35/ }).click();

  await expect(page).toHaveURL(/\/jobs\/11111111/);
  await expect(page.getByRole("heading", { name: /Senior DevOps Engineer/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to save" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview listing" })).toBeDisabled();
  await expect(page.getByText("Demo data never submits an application.")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("account flow has explicit modes and neutral sign-in errors", async ({ page }) => {
  await page.goto("/account?next=%2Fdashboard");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email").fill("contractor@example.com");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.getByText(/couldn't sign you in with those details/i)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("mobile navigation exposes all primary destinations", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only interaction");
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Find contracts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "IR35 guides" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tools" })).toBeVisible();
});

test("CV Studio analyses, verifies, versions and exports a role-tailored CV", async ({ page, request }) => {
  const parsed = await request.post("/api/resume/parse", {
    multipart: {
      file: {
        name: "contractor-cv.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Alex Morgan\n\nPROFILE\nCloud contractor\n\nSKILLS\nAWS Terraform\n\nEXPERIENCE\n- Built AWS services with Terraform for UK clients."),
      },
    },
  });
  expect(parsed.ok()).toBeTruthy();
  expect((await parsed.json()).text).toContain("AWS Terraform");

  await page.goto("/jobs/11111111-1111-4111-8111-111111111111/resume");
  await expect(page.getByRole("heading", { name: "Tailor your CV with evidence you control" })).toBeVisible();
  await page.getByRole("button", { name: "Try the labelled sample CV" }).click();
  await page.getByRole("button", { name: "Analyse against this role" }).click();

  await expect(page.getByRole("heading", { name: "Review every suggested change" })).toBeVisible();
  await expect(page.getByText("Missing - not assumed")).toBeVisible();
  const kubernetesSuggestion = page.getByRole("article").filter({ hasText: "Verify Kubernetes" });
  await expect(kubernetesSuggestion.getByText("Not found in your CV")).toBeVisible();
  await kubernetesSuggestion.getByRole("button", { name: "I genuinely have this" }).click();
  await expect(kubernetesSuggestion.getByRole("button", { name: "Experience confirmed" })).toBeVisible();

  await page.getByRole("button", { name: "Build approved version" }).click();
  const editor = page.getByLabel("Tailored CV text");
  await expect(editor).toHaveValue(/VERIFIED ROLE SKILLS/);
  await expect(editor).toHaveValue(/Kubernetes/);
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText("Draft version saved.")).toBeVisible();
  await expect(page.getByText("Role-tailored CV").last()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await expectNoSeriousA11yViolations(page);
});

test("application workspace prepares, approves, receipts and tracks without submitting", async ({ page }) => {
  await page.goto("/applications/new/11111111-1111-4111-8111-111111111111");
  await expect(page.getByRole("heading", { name: "Prepare for Northstar Digital" })).toBeVisible();
  await expect(page.getByText(/Data stays in this browser/)).toBeVisible();
  await page.getByRole("button", { name: "Load labelled sample CV" }).click();
  await page.getByRole("button", { name: "Prepare application" }).click();

  await expect(page.getByRole("heading", { name: /CV match/ })).toBeVisible();
  await expect(page.getByText("Missing—not assumed")).toBeVisible();
  const checkboxes = page.getByRole("checkbox");
  const checkboxCount = await checkboxes.count();
  expect(checkboxCount).toBeGreaterThanOrEqual(7);
  for (let index = 0; index < checkboxCount; index += 1) {
    await checkboxes.nth(index).check();
  }

  await page.getByRole("button", { name: "Approve dry run" }).click();
  await expect(page.getByTestId("application-receipt")).toContainText("No application or personal data was sent");
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("link", { name: /Open tracker/ }).click();
  await expect(page.getByRole("heading", { name: "Your contract pipeline" })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();

  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Responses linked to the right role" })).toBeVisible();
  await expect(page.getByText("alex.morgan@inbox.ir35careers.local")).toBeVisible();

  await page.goto("/automation");
  await expect(page.getByRole("heading", { name: "Set the rules once. Review every packet." })).toBeVisible();
  await page.getByRole("switch", { name: "Paused" }).click();
  await page.getByRole("button", { name: "Run preview now" }).click();
  await expect(page.getByText(/contracts entered the review queue/)).toBeVisible();
});
