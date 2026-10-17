import { expect, test } from "@playwright/test";

async function dismissPrivacyNotice(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: "Essential only", exact: true });
  if (await button.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) {
    await button.click();
  }
}

test("take-home calculator recalculates safely from assignment inputs", async ({ page }) => {
  await page.goto("/tools/take-home");
  await dismissPrivacyNotice(page);

  await expect(page.getByRole("heading", { name: "IR35 take-home calculator" })).toBeVisible();
  await expect(page.getByTestId("assignment-income")).toHaveText("£110,000");
  await expect(page.getByTestId("inside-take-home")).not.toHaveText("£0");
  await expect(page.getByTestId("outside-take-home")).not.toHaveText("£0");
  await expect(page.getByLabel("Annual business expenses (£)")).toHaveValue("");

  const billableDays = page.getByLabel("Billable days / year");
  await billableDays.clear();
  await expect(billableDays).toHaveValue("");
  await billableDays.fill("220");
  await page.getByRole("heading", { name: "IR35 take-home calculator" }).click();
  await billableDays.click();
  await billableDays.pressSequentially("200");
  await expect(billableDays).toHaveValue("200");
  await billableDays.fill("220");

  await page.getByLabel("Day rate (£)").clear();
  await expect(page.getByLabel("Day rate (£)")).toHaveValue("");
  await expect(page.getByTestId("assignment-income")).toHaveText("£0");
  await expect(page.getByTestId("inside-take-home")).toHaveText("£0");
  await expect(page.getByTestId("outside-take-home")).toHaveText("£0");

  await page.getByRole("button", { name: "monthly", exact: true }).click();
  await expect(page.getByLabel("Billable days / month")).toHaveValue("18.33");
  await page.getByLabel("Day rate (£)").fill("650");
  await page.getByLabel("Billable days / month").fill("20");
  await page.getByLabel("Monthly business expenses (£)").fill("500");
  await page.getByLabel("Monthly umbrella fee (£)").fill("125");
  await expect(page.getByTestId("assignment-income")).toHaveText("£13,000");
  await expect(page.getByText("Employer National Insurance", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "annual", exact: true }).click();
  await expect(page.getByLabel("Billable days / year")).toHaveValue("240");
  await expect(page.getByLabel("Annual business expenses (£)")).toHaveValue("6000");
  await expect(page.getByLabel("Annual umbrella fee (£)")).toHaveValue("1500");
  await expect(page.getByTestId("assignment-income")).toHaveText("£156,000");
});

test("IR35 status checker accepts answers and displays an indicative result", async ({ page }) => {
  await page.goto("/tools/ir35-status");
  await dismissPrivacyNotice(page);

  const cards = page.locator("main .space-y-3 > div");
  await expect(cards).toHaveCount(8);
  for (let index = 0; index < 8; index += 1) {
    await cards.nth(index).getByRole("button", { name: "yes", exact: true }).click();
  }

  await page.getByRole("button", { name: "See result" }).click();
  await expect(page.getByText("Likely Outside IR35", { exact: true })).toBeVisible();
  await expect(page.getByText("100% toward outside IR35 on your answers.")).toBeVisible();
});
