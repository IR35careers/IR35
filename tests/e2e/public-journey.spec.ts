import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";
import { hasStatedSponsorship, isSeniorityFilter, matchesSeniorityTitle } from "../../src/lib/job-search-filters";

async function expectNoSeriousA11yViolations(page: import("@playwright/test").Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const results = await new AxeBuilder({ page })
        .exclude("[data-nextjs-toast]")
        .exclude("nextjs-portal")
        .analyze();
      const serious = results.violations.filter((violation) =>
        violation.impact === "critical" || violation.impact === "serious"
      );
      expect(serious, serious.map((item) => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
      return;
    } catch (error) {
      const navigatedDuringScan =
        error instanceof Error &&
        /execution context was destroyed|most likely because of a navigation/i.test(error.message);
      if (attempt === 0 && navigatedDuringScan) {
        await page.waitForLoadState("load");
        continue;
      }
      throw error;
    }
  }
}

async function dismissPrivacyNotice(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: "Understood", exact: true });
  if (await button.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
    await button.click();
  }
}

async function waitForReactHydration(page: import("@playwright/test").Page) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some((button) =>
      Object.keys(button).some((key) => key.startsWith("__reactProps$")),
    ),
  );
}

async function completeReusableApplicationProfile(
  page: import("@playwright/test").Page,
) {
  const selectAnswer = async (label: string, value: "yes" | "no") => {
    const field = page.getByLabel(label);
    await field.selectOption(value);
    // Give the controlled field time to commit before changing the next one.
    // Without this pause, very fast automation can overwrite the prior update.
    await page.waitForTimeout(300);
    await expect(field).toHaveValue(value);
  };
  await page.goto("/profile");
  await dismissPrivacyNotice(page);
  await page.getByRole("button", { name: "Application answers", exact: true }).click();
  await selectAnswer("Are you willing to travel for work?", "yes");
  await selectAnswer("Are you willing to work shifts?", "no");
  await selectAnswer("Are you willing to work weekends?", "no");
  await expect(page.getByRole("heading", { name: /profile item left/ })).toBeVisible();
  await selectAnswer("Can an employer run a standard background check?", "yes");
  await selectAnswer("Do you have convictions that must be declared for the role?", "no");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("button", { name: "Profile saved" })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Your reusable application profile is ready",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Edit Resume text" }).click();
  await page.getByLabel("Resume text").fill(
    "Alex Morgan\nSenior Platform Engineer\nTen years of experience delivering secure AWS, Terraform and Kubernetes platforms for UK organisations. Built CI and CD controls, observability, incident response and infrastructure automation across regulated environments.",
  );
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("button", { name: "Profile saved" })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Your reusable application profile is ready",
    }),
  ).toBeVisible();
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
  await expect(page.getByText(/Preview roles are shown in this local workspace/i)).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);

  await page.goto("/jobs");
  await expect(page.getByText("6 contracts found")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search contracts" }).fill("DevOps");
  await expect(page.getByText("1 contracts found")).toBeVisible();
  await page.getByRole("link", { name: /Senior DevOps Engineer - Outside IR35/ }).click();

  await expect(page).toHaveURL(/\/jobs\/11111111/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /Senior DevOps Engineer/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to save" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview listing" })).toBeDisabled();
  await expect(page.getByText("Demo data never submits an application.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Advertiser-stated" })).toBeVisible();
  await expect(page.getByText("IR35 evidence", { exact: true })).toBeVisible();
  await page.getByText("Why this status", { exact: true }).click();
  await expect(page.getByText(/Evidence checked/)).toBeVisible();
  await expect(page.getByText(/not an independent legal determination/i)).toBeVisible();
  await page.getByText("How this score is calculated").click();
  await expect(page.getByText("Skill overlap")).toBeVisible();
  await expect(page.getByText("Rate fit")).toBeVisible();
  await expect(page.getByText(/not an AI assessment, hiring prediction or guarantee/i)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("contract search keeps a stable shell while initial results load", async ({ page }) => {
  let releaseSearch: () => void = () => undefined;
  const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
  await page.route("**/api/jobs/search**", async (route) => {
    await searchGate;
    await route.continue();
  });

  await page.goto("/jobs", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Find your next contract" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading contracts" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);

  releaseSearch();
  await expect(page.getByText(/[\d,]+ contracts found/)).toBeVisible();
});

test("contract results do not wait for facet aggregation", async ({ page }) => {
  let releaseFacets: () => void = () => undefined;
  let noteFacetRequest: () => void = () => undefined;
  const facetGate = new Promise<void>((resolve) => { releaseFacets = resolve; });
  const facetRequestSeen = new Promise<void>((resolve) => { noteFacetRequest = resolve; });
  const searchRequests: URL[] = [];

  await page.route("**/api/jobs/search**", async (route) => {
    const url = new URL(route.request().url());
    searchRequests.push(url);
    if (url.searchParams.get("with_facets") === "1") {
      noteFacetRequest();
      await facetGate;
    }
    await route.continue();
  });

  try {
    await page.goto("/jobs");
    await expect(page.getByText("6 contracts found")).toBeVisible();
    await facetRequestSeen;

    const resultRequest = searchRequests.find((url) => url.searchParams.get("with_facets") !== "1");
    const facetRequest = searchRequests.find((url) => url.searchParams.get("with_facets") === "1");
    expect(resultRequest?.searchParams.get("per_page")).toBe("12");
    expect(facetRequest?.searchParams.get("per_page")).toBe("1");
  } finally {
    releaseFacets();
  }
});

test("advanced contract filters use explicit listing evidence", async ({ page }) => {
  await page.route("**/api/jobs/search**", async (route) => {
    const url = new URL(route.request().url());
    const seniority = url.searchParams.get("seniority") ?? "";
    const rateType = url.searchParams.get("rate_type") ?? "";
    const sponsorship = url.searchParams.get("sponsorship") ?? "";
    const jobs = DEMO_JOBS.filter((job) => {
      if (isSeniorityFilter(seniority) && !matchesSeniorityTitle(job.title, seniority)) return false;
      if (rateType && job.rate_type !== rateType) return false;
      if (sponsorship === "stated" && !hasStatedSponsorship(job.description)) return false;
      return true;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobs,
        total: jobs.length,
        facets: {
          outside: jobs.filter((job) => job.ir35_status === "outside").length,
          inside: jobs.filter((job) => job.ir35_status === "inside").length,
          tbc: jobs.filter((job) => job.ir35_status === "unknown").length,
          remote: jobs.filter((job) => job.remote_type === "remote").length,
          hybrid: jobs.filter((job) => job.remote_type === "hybrid").length,
          onsite: jobs.filter((job) => job.remote_type === "onsite").length,
        },
        page: 1,
        per_page: Number(url.searchParams.get("per_page") ?? 12),
        data_source: "demo",
        generated_at: "2026-08-20T09:00:00.000Z",
      }),
    });
  });
  await page.goto("/jobs");
  await expect(page.getByText("6 contracts found")).toBeVisible();

  if (await page.locator("aside:visible").count() === 0) {
    await page.getByRole("button", { name: "Filters" }).click();
  }
  const filters = page.locator("aside:visible").filter({ has: page.getByLabel("Seniority") }).first();
  await filters.getByLabel("Seniority").selectOption("senior");
  await expect(page.getByText("2 contracts found")).toBeVisible();
  await filters.getByLabel("Rate basis").selectOption("daily");
  await filters.getByRole("button", { name: "Sponsorship explicitly offered" }).click();
  await expect(page.getByText("1 contracts found")).toBeVisible();
  await expect(page.getByRole("link", { name: /Senior DevOps Engineer/ })).toBeVisible();
  await expect(page).toHaveURL(/seniority=senior/);
  await expect(page).toHaveURL(/rate_type=daily/);
  await expect(page).toHaveURL(/sponsorship=stated/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await expectNoSeriousA11yViolations(page);
});

test("account flow has explicit modes and neutral sign-in errors", async ({ page }) => {
  await page.goto("/account?next=%2Fdashboard");
  await dismissPrivacyNotice(page);
  await waitForReactHydration(page);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to sign in" })).toBeVisible();

  const createPage = await page.context().newPage();
  await createPage.goto("/account?next=%2Fdashboard&mode=create");
  await waitForReactHydration(createPage);
  await expect(createPage.getByRole("heading", { name: "Create your account" })).toBeVisible();

  const signInPage = await page.context().newPage();
  await signInPage.goto("/account?next=%2Fdashboard");
  await waitForReactHydration(signInPage);
  await expect(signInPage.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await signInPage.getByLabel("Email").fill("contractor@example.com");
  await signInPage.getByLabel("Password").fill("test-password");
  await signInPage.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(signInPage.getByText(/couldn't sign you in with those details/i)).toBeVisible();
  await expectNoSeriousA11yViolations(signInPage);
});

test("an external job can be previewed and opened in local Resume Studio", async ({ page }) => {
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
  await expect(page.getByText("Advertiser-stated in the job title")).toBeVisible();
  await page.getByRole("button", { name: "Tailor Resume locally" }).click();
  await expect(page.getByRole("heading", { name: "Tailor your Resume with evidence you control" })).toBeVisible();
  await expect(page.getByText(/Scores are transparent, missing keywords are never treated as experience/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("public trust and platform surfaces are available", async ({ page }) => {
  test.setTimeout(180_000);
  const pages = [
    ["/pricing", "Free throughout the current public beta."],
    ["/platforms", "One contractor workspace, on every screen."],
    ["/mobile", "Your IR35 contract search, ready on any screen."],
    ["/messaging", "Responses linked to the right role."],
    ["/ai-disclosure", "AI and Automation Disclosure"],
    ["/security", "Security and Responsible Disclosure"],
    ["/bug-bounty", "Report a security issue safely."],
    ["/billing-policy", "Billing, Cancellation and Refund Policy"],
    ["/delete-account", "Delete your account"],
  ] as const;
  for (const [url, heading] of pages) {
    await page.goto(url);
    await dismissPrivacyNotice(page);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.goto("/developers");
  await expect(page).toHaveURL(/\/jobs(?:\?|$)/);
  await page.goto("/connections");
  await expect(page).toHaveURL(/\/platforms(?:\?|$)/);
  await expectNoSeriousA11yViolations(page);
});

test("operational feed health stays out of the public website", async ({ page, request }) => {
  test.setTimeout(180_000);
  const response = await request.get("/api/jobs/health", { timeout: 60_000 });
  expect(response.status()).toBe(404);

  await page.goto("/jobs/sources");
  await expect(page).toHaveURL(/\/jobs(?:\?|$)/);
  await expect(page.getByRole("link", { name: "View feed health" })).toHaveCount(0);
  await expect(page.getByText("Daily source refresh and duplicate reduction")).toHaveCount(0);
  await expect(page.getByText("Explicit IR35 evidence labels")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Analyse a job URL" })).toHaveCount(0);
});

test("public platform assets and safety boundaries respond correctly", async ({ request }) => {
  test.setTimeout(180_000);
  const manifest = await request.get("/manifest.webmanifest", { timeout: 60_000 });
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).name).toBe("IR35Careers Public Beta");

  const securityPolicy = await request.get("/.well-known/security.txt", { timeout: 60_000 });
  expect(securityPolicy.ok()).toBeTruthy();
  expect(securityPolicy.headers()["content-type"]).toContain("text/plain");
  expect(await securityPolicy.text()).toContain("Policy: https://www.ir35careers.com/bug-bounty");

  const retiredDownloads = [
    ["/downloads/ir35careers-cli.mjs", "/jobs"],
    ["/downloads/ir35careers-mcp-v1.zip", "/jobs"],
  ] as const;
  for (const [path, destination] of retiredDownloads) {
    const response = await request.get(path, { maxRedirects: 0, timeout: 60_000 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(destination);
  }

  const retiredExtension = await request.get(
    "/downloads/ir35careers-chrome-extension-v1.zip",
    { maxRedirects: 0, timeout: 60_000 },
  );
  expect(retiredExtension.status()).toBe(308);
  expect(retiredExtension.headers().location).toBe(
    "/downloads/ir35careers-chrome-extension-v2.zip",
  );
  const applicationAssistant = await request.get(
    "/downloads/ir35careers-chrome-extension-v2.zip",
    { timeout: 60_000 },
  );
  expect(applicationAssistant.ok()).toBeTruthy();
  expect(applicationAssistant.headers()["content-type"]).toContain("zip");
  expect((await applicationAssistant.body()).byteLength).toBeGreaterThan(10_000);

  const search = await request.get("/api/jobs/search?per_page=1", { timeout: 60_000 });
  expect(search.ok()).toBeTruthy();
  const searchPayload = await search.json();
  expect(searchPayload.jobs.length).toBeGreaterThan(0);
  const firstJob = searchPayload.jobs[0];
  const publicJobFields = new Set([
    "id", "title", "company_name", "location", "remote_type", "ir35_status", "ir35_confidence",
    "rate_min", "rate_max", "rate_currency", "rate_type", "skills", "posted_at", "first_seen_at",
    "last_seen_at", "source_domain",
  ]);
  expect(Object.keys(firstJob).every((key) => publicJobFields.has(key))).toBe(true);
  expect(firstJob).not.toHaveProperty("description");
  expect(firstJob).not.toHaveProperty("apply_url");

  const detail = await request.get(`/api/jobs/${firstJob.id}`, { timeout: 60_000 });
  expect(detail.ok()).toBeTruthy();
  expect((await detail.json()).job.id).toBe(firstJob.id);

  const connections = await request.get("/api/integrations/status", { timeout: 60_000 });
  expect(connections.status()).toBe(401);

  const accountExport = await request.get("/api/account", { timeout: 60_000 });
  expect(accountExport.status()).toBe(401);

  const checkout = await request.post("/api/billing/checkout", { timeout: 60_000 });
  expect(checkout.status()).toBe(503);
  expect((await checkout.json()).error).toMatch(/not connected/i);

  const billingWebhook = await request.post("/api/integrations/billing/webhook", { data: {}, timeout: 60_000 });
  expect(billingWebhook.status()).toBe(503);

  const privatePreview = await request.post("/api/jobs/preview", { data: { url: "https://127.0.0.1/private" }, timeout: 60_000 });
  expect(privatePreview.status()).toBe(400);
  expect((await privatePreview.json()).error).toMatch(/public (?:HTTPS|website)/i);
});

test("reduced motion preserves navigation and removes routine animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/mobile");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Your IR35 contract search, ready on any screen." })).toBeVisible();
  await expect(page.getByRole("status", { name: "Mobile app readiness" })).toBeVisible();
  const motion = await page.evaluate(() => {
    const control = document.querySelector("main a");
    const duration = control ? getComputedStyle(control).transitionDuration : "0s";
    const value = Number.parseFloat(duration);
    return {
      media: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      transitionMilliseconds: Number.isFinite(value) ? value * (duration.includes("ms") ? 1 : 1000) : 0,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  expect(motion.media).toBe(true);
  expect(motion.scrollBehavior).toBe("auto");
  expect(motion.transitionMilliseconds).toBeLessThanOrEqual(0.02);
  expect(motion.overflow).toBe(false);
  await expectNoSeriousA11yViolations(page);
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

test("Resume Studio analyses, verifies, versions and exports a role-ready Resume", async ({ page, request }) => {
  test.setTimeout(180_000);
  const parsed = await request.post("/api/resume/parse", {
    multipart: {
      file: {
        name: "contractor-cv.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Alex Morgan\n\nPROFILE\nCloud contractor\n\nSKILLS\nAWS Terraform\n\nEXPERIENCE\n- Built AWS services with Terraform for UK clients."),
      },
    },
    timeout: 60_000,
  });
  expect(parsed.ok()).toBeTruthy();
  expect((await parsed.json()).text).toContain("AWS Terraform");

  const blockedActivePdf = await request.post("/api/resume/parse", {
    multipart: {
      file: {
        name: "active.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7\n1 0 obj <</OpenAction 2 0 R>>"),
      },
    },
    timeout: 60_000,
  });
  expect(blockedActivePdf.status()).toBe(400);
  expect((await blockedActivePdf.json()).error).toMatch(/active or embedded content/i);

  await page.goto("/jobs/11111111-1111-4111-8111-111111111111/resume");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Tailor your Resume with evidence you control" })).toBeVisible();
  await page.getByRole("button", { name: "Try the labelled sample Resume" }).click();
  await page.getByRole("button", { name: "Analyse against this role" }).click();

  await expect(page.getByRole("heading", { name: "Review every suggested change" })).toBeVisible();
  await expect(page.getByText("Missing - not assumed")).toBeVisible();
  const kubernetesSuggestion = page.getByRole("article").filter({ hasText: "Verify Kubernetes" });
  await expect(kubernetesSuggestion.getByText("Not found in your Resume")).toBeVisible();
  await kubernetesSuggestion.getByRole("button", { name: "I genuinely have this" }).click();
  await expect(kubernetesSuggestion.getByRole("button", { name: "Experience confirmed" })).toBeVisible();

  await page.getByRole("button", { name: "Build approved version" }).click();
  const editor = page.getByLabel("Resume text");
  await expect(editor).toHaveValue(/VERIFIED ROLE SKILLS/);
  await expect(editor).toHaveValue(/Kubernetes/);
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText("Draft version saved.")).toBeVisible();
  await expect(page.getByText("Application Resume").last()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await expectNoSeriousA11yViolations(page);
});

test("application workspace presents a clean review flow and never claims an unconfirmed submission", async ({ page }) => {
  await completeReusableApplicationProfile(page);
  await page.goto("/applications/new/11111111-1111-4111-8111-111111111111");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Apply to Northstar Digital" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complete your reusable profile before applying" })).toHaveCount(0);
  await expect(page.getByLabel("Resume text")).toHaveValue(/AWS, Terraform and Kubernetes/);
  await page.getByRole("button", { name: "Prepare application" }).click();

  await expect(page.getByRole("heading", { name: "Senior DevOps Engineer - Outside IR35" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Application record" })).toBeVisible();
  await expect(page.getByText("Application email", { exact: true })).toBeVisible();
  await expect(page.getByText("Employer questions", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByText("Prepared for Senior DevOps Engineer - Outside IR35 at Northstar Digital")).toBeVisible();
  await page.getByRole("button", { name: "Edit Resume" }).click();
  await expect(page.getByLabel("Resume text")).toHaveValue(/AWS, Terraform and Kubernetes/);
  await expect(page.getByRole("button", { name: "Improve Resume" })).toBeVisible();
  await page.getByRole("button", { name: "Cover letter", exact: true }).click();
  await expect(page.getByLabel("Cover letter")).toBeVisible();
  await page.getByRole("button", { name: "Contract", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Contract description" })).toBeVisible();
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await expect(page.getByRole("button", { name: "Submit application" })).toBeVisible();
  await expect(page.getByText("Employer confirmation received")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "Your contract pipeline" })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Review and apply" }).first()).toBeVisible();

  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Your application messages" })).toBeVisible();
  await expect(page.getByText("alex.morgan@inbox.ir35careers.local")).toBeVisible();
  await expect(page.getByText("alex.morgan@example.test", { exact: true }).first()).toBeVisible();

  await page.goto("/automation");
  await expect(page.getByRole("heading", { name: "Set your preferences once" })).toBeVisible();
  await page.getByRole("button", { name: "3. Permission" }).click();
  await expect(page.getByText(/Allow IR35Careers to apply to my matching roles/i)).toBeVisible();
  await page.getByRole("button", { name: "1. Contract matches" }).click();
  await page.getByRole("button", { name: "Preview matches" }).click();
  await expect(page.getByText(/matching contracts? found/i)).toBeVisible();
});

test("saved alerts preview current matches without claiming email delivery", async ({ page }) => {
  await page.goto("/alerts");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Job alerts" })).toBeVisible();
  await expect(page.getByText("Open any alert to see the newest contracts that match your preferences.")).toBeVisible();

  await page.getByRole("button", { name: "Preview matches" }).first().click();
  await expect(page.getByText(/current matches/)).toBeVisible();
  await expect(page.getByText("This preview does not send a notification.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Senior DevOps Engineer/ })).toBeVisible();

  await page.getByRole("button", { name: "New alert" }).click();
  await page.getByLabel("Alert name").fill("Remote cloud contracts");
  await page.getByLabel("Keyword").fill("AWS");
  await page.getByRole("combobox", { name: "IR35", exact: true }).selectOption("outside");
  await page.getByLabel("Seniority").selectOption("senior");
  await page.getByLabel("Rate basis").selectOption("daily");
  await page.getByLabel("Sponsorship explicitly offered").check();
  await page.getByRole("button", { name: "AWS", exact: true }).click();
  await page.getByRole("button", { name: "Save alert" }).click();
  await expect(page.getByText("Preview alert saved in this browser session.")).toBeVisible();

  const createdAlert = page.locator("article").filter({ hasText: "Remote cloud contracts" });
  await expect(createdAlert).toBeVisible();
  await expect(createdAlert).toContainText("Senior");
  await expect(createdAlert).toContainText("Sponsorship explicitly offered");
  await createdAlert.getByRole("button", { name: "Delete Remote cloud contracts" }).click();
  await createdAlert.getByRole("button", { name: "Confirm delete Remote cloud contracts" }).click();
  await expect(page.getByText("Alert deleted.")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
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

test("application analytics explains outcomes and exports bounded role data", async ({ page }) => {
  await page.goto("/analytics");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "See what is moving your contract search forward" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Application analytics summary" }).getByText("Prepared", { exact: true })).toBeVisible();
  await expect(page.getByText("100%", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review signals" })).toBeVisible();
  await expect(page.getByText(/1 recruiter message needs review/i)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^ir35careers-application-analytics-.*\.csv$/);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath as string, "utf8");
  expect(csv).toContain("Application ID,Role,Company,Status");
  expect(csv).toContain("Northstar Digital");
  expect(csv).not.toContain("PROFESSIONAL SUMMARY");
  expect(csv).not.toContain("Thanks for sharing your details");

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await expectNoSeriousA11yViolations(page);
});

test("billing remains transparent and disabled without a complete provider configuration", async ({ page }) => {
  await page.goto("/billing");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Choose the plan that fits your search" })).toBeVisible();
  await expect(page.getByText("Contractor Free", { exact: true })).toBeVisible();
  await expect(page.getByText("Contractor Pro", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Plans are not available yet" })).toBeDisabled();
  await expect(page.getByText("Pricing and renewal terms are confirmed before payment.")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});
