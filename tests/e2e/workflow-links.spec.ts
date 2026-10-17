import { expect, test } from "@playwright/test";

const WORKFLOW_ROUTES = [
  { name: /^Browse contracts/, href: "/jobs" },
  { name: /Inside or outside: what changes\?/, href: "/blog/inside-vs-outside-ir35-contract-checks" },
  { name: /Compare estimated take-home pay/, href: "/tools/take-home" },
  { name: /Review the shape of an engagement/, href: "/tools/ir35-status" },
];

test("homepage entry actions and guidance use stable production routes", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("form", { name: "Search UK contracts" })).toHaveAttribute("action", "/jobs");

  for (const entry of WORKFLOW_ROUTES) {
    await expect(page.getByRole("main").getByRole("link", { name: entry.name })).toHaveAttribute("href", entry.href);
    const response = await request.get(entry.href.split("#")[0]);
    expect(response.status(), `${entry.href} should not return a missing page`).toBeLessThan(400);
  }
});
