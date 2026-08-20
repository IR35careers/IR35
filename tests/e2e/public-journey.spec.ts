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

async function dismissPrivacyNotice(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: "Understood", exact: true });
  if (await button.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
    await button.click();
  }
}

test("public search-to-detail journey is usable and truthful", async ({ page, request }) => {
  const response = await request.get("/api/jobs/search?q=DevOps&with_facets=1");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.data_source).toBe("demo");
  expect(payload.jobs).toHaveLength(1);

  await page.goto("/");
  await dismissPrivacyNotice(page);
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
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email").fill("contractor@example.com");
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.getByText(/couldn't sign you in with those details/i)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("an external job can be previewed and opened in local CV Studio", async ({ page }) => {
  await page.route("**/api/jobs/preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ job: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Platform Engineer Contract - Outside IR35",
        company_name: "Example Systems",
        location: "Manchester, GB",
        remote_type: "hybrid",
        ir35_status: "outside",
        ir35_confidence: "high",
        rate_min: 600,
        rate_max: 700,
        rate_currency: "GBP",
        rate_type: "daily",
        skills: ["TypeScript", "AWS", "Terraform"],
        posted_at: "2026-08-20",
        first_seen_at: "2026-08-20T00:00:00.000Z",
        last_seen_at: "2026-08-20T00:00:00.000Z",
        description: "Six month platform contract using TypeScript, AWS and Terraform. Outside IR35.",
        apply_url: "https://jobs.example.com/platform",
        source_domain: "jobs.example.com",
      } }),
    });
  });
  await page.goto("/analyse-job");
  await dismissPrivacyNotice(page);
  await page.getByLabel("Public job URL").fill("https://jobs.example.com/platform");
  await page.getByRole("button", { name: "Analyse job" }).click();
  await expect(page.getByRole("heading", { name: /Platform Engineer Contract/ })).toBeVisible();
  await expect(page.getByText("Status stated in the job title")).toBeVisible();
  await page.getByRole("button", { name: "Tailor CV locally" }).click();
  await expect(page.getByRole("heading", { name: "Tailor your CV with evidence you control" })).toBeVisible();
  await expect(page.getByText(/Scores are transparent, missing keywords are never treated as experience/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("public trust and platform surfaces are available", async ({ page }) => {
  const pages = [
    ["/pricing", "Free while the provider-backed service is being verified."],
    ["/platforms", "One contractor workspace, across every useful screen."],
    ["/developers", "Contract search, with IR35 context."],
    ["/connections", "Every integration, in its real state."],
    ["/ai-disclosure", "AI and Automation Disclosure"],
    ["/security", "Security and Responsible Disclosure"],
    ["/delete-account", "Delete your account"],
  ] as const;
  for (const [url, heading] of pages) {
    await page.goto(url);
    await dismissPrivacyNotice(page);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expectNoSeriousA11yViolations(page);
});

test("public platform assets and safety boundaries respond correctly", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).name).toBe("IR35Careers");

  const extension = await request.get("/downloads/ir35careers-chrome-extension-v1.zip");
  expect(extension.ok()).toBeTruthy();
  expect(extension.headers()["content-type"]).toContain("zip");

  const cli = await request.get("/downloads/ir35careers-cli.mjs");
  expect(cli.ok()).toBeTruthy();
  expect(await cli.text()).toContain("never submits an application");

  const mcp = await request.get("/downloads/ir35careers-mcp-v1.zip");
  expect(mcp.ok()).toBeTruthy();
  expect(mcp.headers()["content-type"]).toContain("zip");

  const detail = await request.get("/api/jobs/11111111-1111-4111-8111-111111111111");
  expect(detail.ok()).toBeTruthy();
  expect((await detail.json()).job.title).toContain("DevOps Engineer");

  const connections = await request.get("/api/integrations/status");
  expect(connections.ok()).toBeTruthy();
  expect((await connections.json()).secret_values_exposed).toBe(false);

  const accountExport = await request.get("/api/account");
  expect(accountExport.status()).toBe(401);

  const privatePreview = await request.post("/api/jobs/preview", { data: { url: "https://127.0.0.1/private" } });
  expect(privatePreview.status()).toBe(400);
  expect((await privatePreview.json()).error).toMatch(/public (?:HTTPS|website)/i);
});

test("mobile navigation exposes all primary destinations", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only interaction");
  await page.goto("/");
  await dismissPrivacyNotice(page);
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
  await dismissPrivacyNotice(page);
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
  await dismissPrivacyNotice(page);
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

test("network workspace prepares reviewed outreach without sending it", async ({ page }) => {
  await page.goto("/network");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Turn real relationships into thoughtful outreach" })).toBeVisible();
  await expect(page.getByText("IR35Careers never contacts anyone for you.")).toBeVisible();

  await page.getByRole("button", { name: "Add" }).click();
  await page.getByLabel("Contact name").fill("Jordan Lee");
  await page.getByLabel("Contact company").fill("Example Client");
  await page.getByLabel("Relationship").fill("former project colleague");
  await page.getByRole("button", { name: "Save contact" }).click();
  await expect(page.getByText("Contact saved.")).toBeVisible();

  await page.getByRole("button", { name: "Create truth-safe draft" }).click();
  await expect(page.getByLabel("Referral message")).toHaveValue(/Hi Jordan/);
  await expect(page.getByLabel("Referral message")).toHaveValue(/No pressure/);
  await page.getByRole("checkbox", { name: /I reviewed this message/ }).check();
  await page.getByRole("button", { name: "Save reviewed" }).click();
  await expect(page.getByText("Reviewed referral draft saved.")).toBeVisible();
  await expect(page.getByText("Jordan Lee", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Jordan Lee", { exact: true })).toBeVisible();
  await expect(page.getByText("reviewed", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await expectNoSeriousA11yViolations(page);
});
