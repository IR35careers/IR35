import { expect, test } from "@playwright/test";

async function dismissPrivacyNotice(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: "Essential only", exact: true });
  if (await button.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) await button.click();
}

test("mobile workspace keeps core destinations one tap away", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile quick navigation only");
  await page.addInitScript(() => {
    window.localStorage.setItem("ir35careers:dashboard-tour:v2:local-preview", "complete");
  });
  await page.goto("/dashboard");
  await dismissPrivacyNotice(page);

  const quickNavigation = page.getByRole("navigation", { name: "Quick workspace navigation" });
  await expect(quickNavigation).toBeVisible();
  await expect(quickNavigation.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard");
  await expect(quickNavigation.getByRole("link", { name: "Browse" })).toHaveAttribute("href", "/jobs");
  await expect(quickNavigation.getByRole("link", { name: "Auto Apply" })).toHaveAttribute("href", "/automation");
  await expect(quickNavigation.getByRole("link", { name: /Tracker/ })).toHaveAttribute("href", "/applications");
  await expect(quickNavigation.getByRole("link", { name: /Inbox/ })).toHaveAttribute("href", "/inbox");

  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  const workspaceMenu = page.locator("#member-mobile-menu");
  await expect(workspaceMenu.getByRole("link", { name: "Job alerts" })).toBeVisible();
  await expect(workspaceMenu.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(workspaceMenu.getByRole("link", { name: "Network" })).toHaveCount(0);
  await expect(workspaceMenu.getByRole("link", { name: "Analytics" })).toHaveCount(0);
  await workspaceMenu.getByRole("button", { name: "Close navigation" }).click();

  for (const destination of [
    { href: "/jobs", name: "Browse" },
    { href: "/automation", name: "Auto Apply" },
    { href: "/applications", name: "Tracker" },
    { href: "/inbox", name: "Inbox" },
  ]) {
    await page.goto(destination.href);
    await expect(
      page
        .getByRole("navigation", { name: "Quick workspace navigation" })
        .getByRole("link", { name: new RegExp(destination.name) }),
    ).toHaveAttribute("aria-current", "page");
  }

  const feedbackLauncher = page.getByRole("button", { name: "Open support" });
  const dockBox = await quickNavigation.boundingBox();
  const launcherBox = await feedbackLauncher.boundingBox();
  expect(dockBox).not.toBeNull();
  expect(launcherBox).not.toBeNull();
  expect(launcherBox!.y + launcherBox!.height).toBeLessThanOrEqual(dockBox!.y - 8);
});

test("profile keeps reusable identity, resume, cover letter and application controls together", async ({ page }) => {
  await page.goto("/profile");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Your professional profile" })).toBeVisible();
  await expect(page.locator('main[data-account-layout="true"]')).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Account" })).toBeVisible();
  await expect(page.getByLabel("Full name")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("Application readiness", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Truth-first profile" })).toBeVisible();
  await page.getByRole("button", { name: "Application answers", exact: true }).click();
  await expect(page.getByLabel("Are you willing to travel for work?")).toBeVisible();
  await expect(page.getByLabel("Target annual salary")).toBeVisible();
  await page.getByRole("button", { name: "About you", exact: true }).click();
  await page.getByLabel("Add your own skill").fill("FinOps");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove FinOps" })).toBeVisible();

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add version" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resume studio" })).toBeVisible();
  await expect(page.getByLabel("Template")).toBeVisible();
  await expect(page.getByLabel("Font")).toBeVisible();
  await expect(page.getByRole("button", { name: "Fit to one page" })).toBeVisible();
  await page.locator('input[type="file"][accept=".pdf,.docx,.txt"]').setInputFiles({
    name: "priya-shah.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`Priya Shah
Senior Salesforce Consultant
priya.shah@example.com | +44 7700 900123 | Bristol, UK

PROFESSIONAL SUMMARY
Salesforce consultant with eight years delivering CRM programmes for regulated organisations.

SKILLS
Salesforce, Agile and Jira

EXPERIENCE
Senior Salesforce Consultant at Example Consulting. Delivered secure Salesforce services and Agile change programmes.`),
  });
  await expect(page.getByText("Filled from your resume", { exact: true })).toBeVisible();
  await expect(page.getByText("Suggestions based on your resume", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Business Analysis/ })).toBeVisible();

  await page.getByRole("button", { name: "Cover letter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cover letter" })).toBeVisible();
  await expect(page.getByLabel("Letter text")).toBeVisible();

  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resume optimisation" })).toBeVisible();
  await expect(page.getByText("Use my private application email", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test("research library ranks practical topics and identifies every source", async ({ page }) => {
  await page.goto("/research");
  await dismissPrivacyNotice(page);
  await expect(page.getByRole("heading", { name: "Evidence for better contract decisions" })).toBeVisible();
  await expect(page.getByText("6 reviewed topics")).toBeVisible();
  await expect(page.getByText("Source: HMRC guidance")).toBeVisible();
  await expect(page.getByText("Source: HMRC contractor facts")).toBeVisible();
  await expect(page.getByText("Source: IR35Careers methodology")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open status checker/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test("incomplete application profiles show the exact next action", async ({ page }) => {
  await page.goto("/applications/new/11111111-1111-4111-8111-111111111111");
  await dismissPrivacyNotice(page);
  await expect(
    page.getByRole("heading", {
      name: "Complete your profile before applying",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Complete profile" })).toHaveAttribute(
    "href",
    /^\/profile\?returnTo=.+#application-readiness$/,
  );
  await expect(page.getByRole("button", { name: "Prepare application" })).toBeDisabled();
});

test("free Auto Apply is limited to five applications per day", async ({ page }) => {
  await page.goto("/automation");
  await dismissPrivacyNotice(page);

  const dailyLimit = page.getByLabel("Daily application limit");
  await expect(dailyLimit).toHaveValue("5");
  await expect(dailyLimit.locator("option")).toHaveCount(6);
  await dailyLimit.selectOption("premium");

  await expect(page.getByText("Premium plans are coming soon", { exact: true })).toBeVisible();
  await expect(page.getByText("The free plan includes up to five applications per day.")).toBeVisible();
  await expect(dailyLimit).toHaveValue("5");
});

test("contractors can open the persistent feedback reporter and attach evidence", async ({ page }) => {
  await page.goto("/profile");
  await dismissPrivacyNotice(page);
  const feedbackButton = page.getByRole("button", { name: "Open support" });
  await expect(feedbackButton).toBeVisible();
  await expect(feedbackButton).toHaveAttribute("data-feedback-capture-ui", "true");
  await feedbackButton.click();
  const dialog = page.getByRole("dialog", { name: "IR35Careers Support" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-feedback-capture-ui", "true");
  await expect(dialog.getByRole("button", { name: "Report an issue" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "My feedback" })).toBeVisible();
  await dialog.getByRole("button", { name: "Capture page" }).click();
  await expect(dialog.getByAltText("Feedback attachment preview")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(/ir35careers-page-\d+\.(webp|jpg)/)).toBeVisible();
  await dialog.getByRole("button", { name: "Remove image" }).click();
  await dialog.getByLabel("What is this about?").selectOption("application");
  await dialog.getByLabel("Short title").fill("Application form is not loading");
  await dialog.getByLabel("What happened?").fill("The application form remained blank after I selected review and apply.");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "application-problem.png",
    mimeType: "image/png",
    buffer: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
  });
  await expect(dialog.getByAltText("Feedback attachment preview")).toBeVisible();
  const sendButton = dialog.getByRole("button", { name: "Send feedback" });
  await expect(sendButton).toBeEnabled();
  await dialog.getByLabel("Short title").fill("");
  await dialog.getByLabel("What happened?").fill("");
  await sendButton.click();
  await expect(dialog.getByText("Add a clear title using at least 5 characters.")).toBeVisible();
  await expect(dialog.getByText("Describe what happened using at least 20 characters.")).toBeVisible();
  await expect(dialog.getByLabel("Short title")).toBeFocused();
  await dialog.getByLabel("Short title").fill("Application form is not loading");
  await dialog.getByLabel("What happened?").fill("The application form remained blank after I selected review and apply.");
  await expect(sendButton).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});
