import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const EXTENSION_ID = "cmfcgaflmkipmmjkcneoobgkdpfkfeoa";
const HANDOFF_TOKEN = "A".repeat(48);
const API_PATTERN =
  "https://www.ir35careers.com/api/applications/browser-handoff**";
const EMPLOYER_PATTERN = "https://employer.example/application**";

function packet() {
  return {
    applicationId: "11111111-1111-4111-8111-111111111111",
    destination: "https://employer.example/application",
    job: { title: "DevOps Engineer", company: "Example Employer" },
    facts: {
      values: {
        first_name: "Anvesh",
        last_name: "Mannuru",
        full_name: "Anvesh Mannuru",
        email: "apply-test@mail.ir35careers.com",
        phone: "+447438977103",
        right_to_work: "yes",
        notice_period: "Two weeks",
      },
      screeningAnswers: [],
    },
    coverLetter: [
      "Dear hiring team,",
      "",
      "I am applying for the DevOps Engineer contract.",
      "",
      "Kind regards,",
      "Anvesh Mannuru",
    ].join("\n"),
    resume: {
      filename: "DevOps-Engineer-CV.pdf",
      mimeType: "application/pdf",
      base64: Buffer.from("%PDF-1.4 controlled extension test").toString(
        "base64",
      ),
    },
    account: {
      enabled: true,
      email: "apply-test@mail.ir35careers.com",
      password: "Safe-Test-Password-7x!",
      automaticEmailVerification: true,
      employerTermsConsent: true,
    },
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

function employerPage() {
  return `<!doctype html>
<html lang="en">
  <body>
    <h1>DevOps Engineer application</h1>
    <form id="job">
      <label>First name<input name="first_name" required></label>
      <label>Last name<input name="last_name" required></label>
      <label>Email<input type="email" name="email" required></label>
      <label>Phone<input name="phone" required></label>
      <label>Upload CV<input type="file" name="resume" required></label>
      <label>Right to work
        <select name="right_to_work" required>
          <option value="">Select</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>
      <label>Notice period<input name="notice_period" required></label>
      <label>Professional registration number<input name="registration" required></label>
      <button type="submit">Submit application</button>
    </form>
    <script>
      document.getElementById("job").addEventListener("submit", (event) => {
        event.preventDefault();
        document.body.innerHTML =
          "<h1>Thank you for applying</h1><p>Application submitted successfully</p>";
      });
    </script>
  </body>
</html>`;
}

async function waitFor(check, timeoutMs = 25_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The Application Assistant test timed out.");
}

async function main() {
  const extensionPath = path.resolve("extensions/chrome");
  const tempRoot = path.resolve(os.tmpdir());
  const profilePath = await fs.mkdtemp(
    path.join(tempRoot, "ir35-extension-test-"),
  );
  const reports = [];
  let context;

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      executablePath: chromium.executablePath(),
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--window-position=-32000,-32000",
        "--window-size=1280,900",
      ],
    });

    await context.route(API_PATTERN, async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        reports.push(JSON.parse(request.postData() || "{}"));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(packet()),
      });
    });
    await context.route(EMPLOYER_PATTERN, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: employerPage(),
      }),
    );

    const page = await context.newPage();
    await page.goto(
      `https://employer.example/application#ir35careers-apply=${HANDOFF_TOKEN}`,
    );

    await waitFor(() =>
      reports.some(
        (report) =>
          report.status === "needs_user" && report.action === "/profile",
      ),
    );
    const needsUser = reports.find(
      (report) =>
        report.status === "needs_user" && report.action === "/profile",
    );
    if (
      !needsUser.questions?.some(
        (question) => question.label === "Professional registration number",
      )
    )
      throw new Error("The unknown employer question was not reported.");

    const valuesBeforeAnswer = await page.evaluate(() => ({
      firstName: document.querySelector('[name="first_name"]')?.value,
      email: document.querySelector('[name="email"]')?.value,
      rightToWork: document.querySelector('[name="right_to_work"]')?.value,
      files: document.querySelector('[name="resume"]')?.files?.length || 0,
    }));
    if (
      valuesBeforeAnswer.firstName !== "Anvesh" ||
      valuesBeforeAnswer.email !== "apply-test@mail.ir35careers.com" ||
      valuesBeforeAnswer.rightToWork !== "yes" ||
      valuesBeforeAnswer.files !== 1
    )
      throw new Error("The approved packet was not filled before the pause.");

    await page.locator('[name="registration"]').fill("REG-12345");
    await page.getByRole("button", { name: "Continue application" }).click();

    await waitFor(() =>
      reports.some((report) => report.status === "submitted"),
    );
    const answerReport = reports.find((report) => report.status === "answers");
    if (
      !answerReport?.questions?.some(
        (question) =>
          question.label === "Professional registration number" &&
          question.answer === "REG-12345",
      )
    )
      throw new Error("The contractor answer was not returned to IR35Careers.");

    const submitted = reports.find((report) => report.status === "submitted");
    if (!/thank you for applying/i.test(submitted.confirmation || ""))
      throw new Error("The employer confirmation was not captured.");
    if (
      !context
        .serviceWorkers()
        .some((worker) =>
          worker.url().startsWith(`chrome-extension://${EXTENSION_ID}/`),
        )
    )
      throw new Error("The expected production extension ID was not loaded.");

    console.log(
      "Application Assistant passed: exact page, CV upload, saved facts, missing answer, resume, and employer confirmation.",
    );
  } finally {
    await context?.close().catch(() => undefined);
    const resolvedProfile = path.resolve(profilePath);
    if (resolvedProfile.startsWith(`${tempRoot}${path.sep}`))
      await fs.rm(resolvedProfile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
