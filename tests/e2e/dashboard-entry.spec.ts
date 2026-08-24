import { expect, test } from "@playwright/test";

test("first dashboard visit has a skippable guided tour and later visits welcome the member back", async ({ page }) => {
  await page.goto("/dashboard");

  const tour = page.getByRole("dialog");
  await expect(tour.getByRole("heading", { name: "Your contractor workspace starts here" })).toBeVisible();
  await expect(tour.getByRole("button", { name: "Skip tour" })).toBeVisible();

  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "Search the roles that fit you" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search roles, skills, companies…" })).toBeVisible();

  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "Compare UK contract opportunities" })).toBeVisible();

  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "Let approved applications run in the background" })).toBeVisible();

  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "See every application and employer reply" })).toBeVisible();

  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "Build matches from facts, never guesses" })).toBeVisible();
  await expect(page.locator('[data-tour="profile-progress"]')).toBeVisible();
  await tour.getByRole("button", { name: "Explore dashboard" }).click();
  await expect(tour).toBeHidden();

  const returningPage = await page.context().newPage();
  await returningPage.goto("/dashboard");
  await expect(returningPage.getByText("Welcome back to IR35Careers.")).toBeVisible();
  await expect(returningPage.getByText(/dashboard, saved contracts and application progress are ready/i)).toBeVisible();
});
