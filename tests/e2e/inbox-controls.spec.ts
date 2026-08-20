import { expect, test } from "@playwright/test";

test("inbox controls stay compact, clear and interactive", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Responses linked to the right role" })).toBeVisible();

  const forwardingSwitch = page.getByRole("switch", { name: "Message forwarding preview" });
  const initialForwardingState = await forwardingSwitch.getAttribute("aria-checked");
  const initialLabel = initialForwardingState === "true" ? "Preview on" : "Preview off";
  const nextLabel = initialForwardingState === "true" ? "Preview off" : "Preview on";
  const switchSize = await forwardingSwitch.boundingBox();

  expect(switchSize?.width).toBeLessThanOrEqual(57);
  expect(switchSize?.height).toBeLessThanOrEqual(33);
  await expect(page.getByText(initialLabel, { exact: true })).toBeVisible();
  await forwardingSwitch.click();
  await expect(forwardingSwitch).toHaveAttribute("aria-checked", initialForwardingState === "true" ? "false" : "true");
  await expect(page.getByText(nextLabel, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Rejections" }).click();
  await expect(page.getByRole("button", { name: "Rejections" })).toHaveAttribute("aria-pressed", "true");
});
