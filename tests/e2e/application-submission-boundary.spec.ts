import { expect, test } from "@playwright/test";
import { chromium } from "playwright-core";
import { runNativeApplication } from "../../src/lib/application-runner/run";
import { ApplicationRunnerPreSubmitError } from "../../src/lib/application-runner/failure";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";
import { SAMPLE_CONTRACTOR_PROFILE } from "../../src/lib/workspace/seed";

for (const outcome of ["cancelled", "navigation-failure", "employer-outage", "closed", "confirmation-lost", "confirmed"] as const) {
  test(`owned runner preserves the submission boundary: ${outcome}`, async ({ browserName }, testInfo) => {
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
        candidate: { ...SAMPLE_CONTRACTOR_PROFILE, fullName: "Alex Morgan", email: "controlled@example.test", phone: "+447700900123" },
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
