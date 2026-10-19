import { expect, test } from "@playwright/test";
import { chromium } from "playwright-core";
import { runNativeApplication } from "../../src/lib/application-runner/run";
import { DEMO_JOBS } from "../../src/lib/demo-jobs";
import { SAMPLE_CONTRACTOR_PROFILE } from "../../src/lib/workspace/seed";
import { TEST_ACCOUNT } from "../../scripts/bots/policy";

test("isolated preview renders real jobs/workspace UI with no external requests or writes", async ({ page, baseURL }) => {
  const writes: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== baseURL) return route.abort();
    if (!["GET", "HEAD"].includes(request.method())) { writes.push(request.method()); return route.abort(); }
    return route.continue();
  });
  for (const path of ["/jobs", "/dashboard"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-ir35-bot-preview"]).toBe("mock-only-v1");
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.locator("main h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  expect(writes).toEqual([]);
});

test("the actual apply engine obtains exactly one mock ATS receipt without employer traffic", async () => {
  const previousExecutable = process.env.CHROME_EXECUTABLE_PATH;
  const previousHeadless = process.env.APPLICATION_RUNNER_HEADLESS;
  process.env.CHROME_EXECUTABLE_PATH = chromium.executablePath();
  process.env.APPLICATION_RUNNER_HEADLESS = "true";
  const launch = chromium.launch.bind(chromium);
  const destination = "https://www.ir35careers.com/testing/bot-mock-ats";
  let submissions = 0;
  chromium.launch = async options => {
    const browser = await launch(options); const newContext = browser.newContext.bind(browser);
    browser.newContext = async contextOptions => {
      const context = await newContext(contextOptions); const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        await page.route("**/*", async route => {
          const url = route.request().url();
          if (url === destination + "/receipt") {
            submissions++;
            return route.fulfill({ contentType: "text/html", body: "<h1>Thank you for applying</h1><p>Your application has been received.</p>" });
          }
          if (url !== destination) return route.abort();
          return route.fulfill({ contentType: "text/html", body: '<!doctype html><h1>Platform Engineer</h1><h2>Apply for this role</h2><form action="/testing/bot-mock-ats/receipt" method="POST"><label>Full Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Telephone<input name="phone" required></label><label>Attach CV<input name="cv" type="file" required></label><button type="submit">Submit application</button></form>' });
        });
        return page;
      };
      return context;
    };
    return browser;
  };
  try {
    const receipt = await runNativeApplication({
      applicationId: "00000000-0000-4000-8000-000000000001", destination,
      job: { ...DEMO_JOBS[0], title: "Platform Engineer", apply_url: destination },
      candidate: { ...SAMPLE_CONTRACTOR_PROFILE, fullName: "Alex Morgan", email: TEST_ACCOUNT, phone: "+447700900123" },
      resume: { label: "Fictional mock CV", text: "Alex Morgan\nPlatform Engineer\nAWS and Terraform delivery experience.\nBuilt and operated UK cloud infrastructure for internal engineering teams." },
      coverLetter: "Fictional mock application only.", screeningAnswers: [],
    }, { budgetMs: 60_000 });
    expect(receipt.state).toBe("submitted"); expect(submissions).toBe(1);
  } finally {
    chromium.launch = launch;
    if (previousExecutable === undefined) delete process.env.CHROME_EXECUTABLE_PATH; else process.env.CHROME_EXECUTABLE_PATH = previousExecutable;
    if (previousHeadless === undefined) delete process.env.APPLICATION_RUNNER_HEADLESS; else process.env.APPLICATION_RUNNER_HEADLESS = previousHeadless;
  }
});
