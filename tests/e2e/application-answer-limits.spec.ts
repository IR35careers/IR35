import { expect, test } from "@playwright/test";
import { chromium } from "playwright-core";
import { z } from "zod";
import { runNativeApplication } from "../../src/lib/application-runner/run";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";
import { SAMPLE_CONTRACTOR_PROFILE } from "../../src/lib/workspace/seed";

const aws = "Built AWS infrastructure using Terraform and EKS.";
const azure = "Operated Azure (AKS, Key Vault and Monitor) for product teams.";

for (const fits of [true, false]) {
  test(`mock employer preserves each question and sentence limits: ${fits ? "fits" : "needs review"}`, async () => {
    const saved = { executable: process.env.CHROME_EXECUTABLE_PATH, headless: process.env.APPLICATION_RUNNER_HEADLESS,
      aiKey: process.env.OPENROUTER_API_KEY };
    process.env.CHROME_EXECUTABLE_PATH = chromium.executablePath();
    process.env.APPLICATION_RUNNER_HEADLESS = "true";
    process.env.OPENROUTER_API_KEY = "";
    const launch = chromium.launch.bind(chromium);
    const destination = "https://www.ir35careers.com/testing/controlled-answer-limits";
    let submissions = 0;
    let submitted: URLSearchParams | undefined;
    let lastValues: { aws: string; azure: string } | undefined;
    chromium.launch = async options => {
      const browser = await launch(options);
      const close = browser.close.bind(browser);
      browser.close = async (...args) => {
        const page = browser.contexts()[0]?.pages()[0];
        if (page && fits === false) lastValues = { aws: await page.locator("#aws").inputValue(), azure: await page.locator("#azure").inputValue() };
        return close(...args);
      };
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async contextOptions => {
        const context = await newContext(contextOptions);
        const newPage = context.newPage.bind(context);
        context.newPage = async () => {
          const page = await newPage();
          await page.route("**/*", async route => {
          const url = route.request().url();
          // Every browser request is intercepted; no real employer is contacted.
          if (!url.startsWith("https://www.ir35careers.com/testing/")) return route.abort();
          if (url.endsWith("/controlled-answer-receive")) {
            submissions += 1;
            submitted = new URLSearchParams(route.request().postData() ?? "");
            return route.fulfill({ contentType: "text/html", body: "<h1>Thank you for applying</h1><p>Your application has been received.</p>" });
          }
          return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><title>Controlled application</title></head><body>
            <h1>Platform Engineer</h1><h2>Apply for this role</h2>
            <form action="/testing/controlled-answer-receive" method="POST">
              <label>Full name<input name="name" required></label><label>Email<input type="email" name="email" required></label>
              <label>Attach CV<input type="file" name="cv" required></label>
              <fieldset><legend>Technical screening</legend>
                <label for="aws">Describe your AWS experience</label><textarea id="aws" name="aws" required maxlength="${aws.length}"></textarea>
                <label for="azure">Describe your Azure experience</label><textarea id="azure" name="azure" required maxlength="${fits ? azure.length : 20}"></textarea>
              </fieldset><button type="submit">Submit application</button>
            </form></body></html>` });
          });
          return page;
        };
        return context;
      };
      return browser;
    };
    try {
      const receipt = await runNativeApplication({
        applicationId: "00000000-0000-4000-8000-000000000002", destination,
        job: { ...DEMO_JOBS[0], title: "Platform Engineer", apply_url: destination },
        candidate: { ...SAMPLE_CONTRACTOR_PROFILE, fullName: "Alex Morgan", email: "anvesh.mannuru+ir35test@gmail.com" },
        resume: { label: "Controlled fixture", text: `Alex Morgan\nPlatform Engineer\n${aws} ${azure}` },
        coverLetter: "Controlled mock application.",
        screeningAnswers: [
          { label: "Describe your AWS experience", answer: `${aws} I also support shared delivery.`, source: "user" },
          { label: "Describe your Azure experience", answer: azure, source: "user" },
        ],
      }, { budgetMs: 60_000 });
      if (fits) {
        expect(receipt.state).toBe("submitted");
        expect(submissions).toBe(1);
        expect(submitted?.get("aws")).toBe(aws);
        expect(submitted?.get("azure")).toBe(azure);
      } else {
        expect(receipt.state).toBe("needs_user");
        expect(submissions).toBe(0);
        const review = z.object({ questions: z.array(z.object({ label: z.string() })) }).parse(receipt.review);
        expect(review.questions.map(q => q.label)).toEqual(["Describe your Azure experience"]);
        expect(lastValues).toEqual({ aws, azure: "" });
      }
    } finally {
      chromium.launch = launch;
      for (const [key, value] of Object.entries({ CHROME_EXECUTABLE_PATH: saved.executable,
        APPLICATION_RUNNER_HEADLESS: saved.headless, OPENROUTER_API_KEY: saved.aiKey })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
}
