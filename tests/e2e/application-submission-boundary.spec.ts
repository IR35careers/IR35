import { expect, test } from "@playwright/test";
import { chromium } from "playwright-core";
import { runNativeApplication } from "../../src/lib/application-runner/run";
import { ApplicationRunnerPreSubmitError } from "../../src/lib/application-runner/failure";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";
import { SAMPLE_CONTRACTOR_PROFILE, createSeedWorkspaceState } from "../../src/lib/workspace/seed";
import { createTestLifecycleDb } from "../helpers/application-lifecycle-db";
import { mapCloudApplication } from "../../src/lib/workspace/repository";

for (const outcome of ["cancelled", "navigation-failure", "employer-outage", "closed", "confirmation-lost", "confirmed"] as const) {
  test(`owned runner preserves the submission boundary: ${outcome}`, async ({ browserName, page }, testInfo) => {
    test.skip(browserName !== "chromium", "Chromium server-runner adapter");
    test.skip(testInfo.project.name !== "desktop-chrome", "Isolated server-runner browser test");
    const previousExecutable = process.env.CHROME_EXECUTABLE_PATH;
    const previousHeadless = process.env.APPLICATION_RUNNER_HEADLESS;
    process.env.CHROME_EXECUTABLE_PATH = previousExecutable || (process.platform === "win32"
      ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
      : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/google/chrome/chrome");
    process.env.APPLICATION_RUNNER_HEADLESS = "true";
    const launch = chromium.launch.bind(chromium);
    const destination = "https://www.ir35careers.com/testing/controlled-submission-boundary";
    let requests = 0;
    chromium.launch = async (options) => {
      const browser = await launch(options);
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (contextOptions) => {
        const context = await newContext(contextOptions);
        const newPage = context.newPage.bind(context);
        context.newPage = async () => {
          const page = await newPage();
          await page.route("**/*", async (route) => {
            const url = route.request().url();
            // No real employer, analytics or customer application traffic.
            if (!url.startsWith("https://www.ir35careers.com/testing/")) return route.abort();
            if (url.endsWith("/controlled-receive")) {
              requests += 1;
              await route.fulfill({ contentType: "text/html", body: outcome === "confirmed"
                ? "<h1>Thank you for applying</h1><p>Your application has been received.</p>"
                : "<h1>Processing</h1>" });
              if (outcome === "confirmation-lost") await page.close();
              return;
            }
            if (outcome === "navigation-failure") return route.abort("connectionfailed");
            if (outcome === "employer-outage" || outcome === "closed") return route.fulfill({ status: outcome === "closed" ? 404 : 503, contentType: "text/html", body: "<h1>Unavailable</h1>" });
            return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><title>Controlled job application</title></head><body>
              <h1>Platform Engineer</h1><h2>Apply for this role</h2>
              <form action="/testing/controlled-receive" method="POST">
                <label>Full Name<input name="name" required></label>
                <label>Email<input name="email" type="email" required></label>
                <label>Telephone<input name="phone" required></label>
                <label>Attach CV<input name="cv" type="file" required></label>
                <button type="submit">Submit application</button>
              </form></body></html>` });
          });
          return page;
        };
        return context;
      };
      return browser;
    };
    try {
      const attempt = runNativeApplication({
        applicationId: "00000000-0000-4000-8000-000000000001", destination,
        job: { ...DEMO_JOBS[0], title: "Platform Engineer", apply_url: destination },
        candidate: { ...SAMPLE_CONTRACTOR_PROFILE, fullName: "Alex Morgan", email: "anvesh.mannuru+ir35test@gmail.com", phone: "+447700900123" },
        resume: { label: "Controlled fixture", text: "Alex Morgan\nPlatform Engineer\nAWS and Terraform delivery experience.\nBuilt and operated UK cloud infrastructure for internal engineering teams." },
        coverLetter: "Controlled application fixture.", screeningAnswers: [],
      }, { budgetMs: 60_000, signal: outcome === "cancelled" ? AbortSignal.abort() : undefined });
      if (outcome === "cancelled" || outcome === "navigation-failure" || outcome === "employer-outage") {
        await expect(attempt).rejects.toBeInstanceOf(ApplicationRunnerPreSubmitError);
        expect(requests).toBe(0);
      } else if (outcome === "closed") {
        const receipt = await attempt;
        expect(receipt.review).toMatchObject({ action: "listing_unavailable" });
        expect(requests).toBe(0);
      } else {
        const receipt = await attempt;
        expect(requests).toBe(1);
        expect(receipt.state).toBe(outcome === "confirmed" ? "submitted" : "needs_user");
        if (outcome === "confirmation-lost") expect(receipt.review).toMatchObject({ action: "confirmation_pending" });
        if (outcome === "confirmed") {
          const db = await createTestLifecycleDb();
          try {
            const userId = "11111111-1111-4111-8111-111111111111";
            const appId = "00000000-0000-4000-8000-000000000001";
            await db.query("INSERT INTO auth.users VALUES($1)", [userId]);
            await db.query(`INSERT INTO application_packets(id,user_id,job_snapshot,status,idempotency_key,
              truth_approved,materials_approved,submission_approved) VALUES($1::uuid,$2,$3,'ready',$1::text,true,true,true)`,
            [appId, userId, JSON.stringify(DEMO_JOBS[0])]);
            await db.query("SELECT transition_application_delivery($1,$2,'queued')", [appId, userId]);
            await db.query("SELECT transition_application_delivery($1,$2,'submitting')", [appId, userId]);
            await db.query("SELECT commit_application_delivery_result($1,$2,'submitted',$3)", [appId, userId, JSON.stringify({
              receiptId: receipt.providerSubmissionId, createdAt: receipt.submittedAt, destination,
              mode: "external_handoff", message: receipt.message, reviewedFields: [], skippedFields: [],
            })]);
            const stored = (await db.query<Record<string, unknown>>("SELECT * FROM application_packets WHERE id=$1", [appId])).rows[0];
            const state = createSeedWorkspaceState();
            state.applications = [mapCloudApplication(stored, [])];
            // Hydrate the real preview UI from the persisted SQL result. This
            // proves reload rendering, not production Realtime connectivity.
            await page.addInitScript(workspace => {
              if (!localStorage.getItem("ir35careers.workspace.v1")) localStorage.setItem("ir35careers.workspace.v1", JSON.stringify(workspace));
              localStorage.setItem("ir35careers:cookie-consent:v1", "essential");
              localStorage.setItem("ir35careers:dashboard-tour:v2:local-preview", "complete");
            }, state);
            await page.goto("/applications");
            const row = page.getByRole("row").filter({ hasText: DEMO_JOBS[0].title });
            await expect(row.getByText("Submitted", { exact: true })).toBeVisible();
            await page.reload();
            await expect(row.getByText("Submitted", { exact: true })).toBeVisible();
            await page.goto(`/applications/new/${DEMO_JOBS[0].id}?applicationId=${appId}`);
            await page.getByRole("button", { name: "Form", exact: true }).click();
            await expect(page.getByRole("heading", { name: "Employer confirmation received" })).toBeVisible();
            await page.reload();
            await page.getByRole("button", { name: "Form", exact: true }).click();
            await expect(page.getByRole("heading", { name: "Employer confirmation received" })).toBeVisible();
            expect(requests).toBe(1);
          } finally { await db.close(); }
        }
      }
    } finally {
      chromium.launch = launch;
      if (previousExecutable === undefined) delete process.env.CHROME_EXECUTABLE_PATH;
      else process.env.CHROME_EXECUTABLE_PATH = previousExecutable;
      if (previousHeadless === undefined) delete process.env.APPLICATION_RUNNER_HEADLESS;
      else process.env.APPLICATION_RUNNER_HEADLESS = previousHeadless;
    }
  });
}
