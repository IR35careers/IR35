import { expect, test } from "@playwright/test";

const WORKFLOW_ROUTES = [
  { name: /^01 Discover/, href: "/jobs" },
  { name: /^02 Understand/, href: "/analyse-job" },
  { name: /^03 Prepare/, href: "/dashboard#matches" },
  { name: /^04 Track/, href: "/applications" },
  { name: /^05 Respond/, href: "/inbox" },
];

test("homepage workflow cards use stable production entry routes", async ({ page, request }) => {
  await page.goto("/");

  for (const entry of WORKFLOW_ROUTES) {
    await expect(page.getByRole("link", { name: entry.name })).toHaveAttribute("href", entry.href);
    const response = await request.get(entry.href.split("#")[0]);
    expect(response.status(), `${entry.href} should not return a missing page`).toBeLessThan(400);
  }
});
