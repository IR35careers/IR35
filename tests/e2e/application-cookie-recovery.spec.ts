import { expect, test } from "@playwright/test";
import { detectAts } from "../../src/lib/application-runner/ats";
import { openApplicationForm } from "../../src/lib/application-runner/run";

test.use({ serviceWorkers: "block" });

for (const redirectedPageHasForm of [false, true]) {
  test(`cookie rejection restores the exact application instead of a ${redirectedPageHasForm ? "different form" : "jobs list"}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "One isolated native adapter test per fixture");
    const destination = "https://www.ir35careers.com/testing/legacy-cookie-form?role=controlled";
    let cookiesRejected = false;
    const form = '<h2>Apply for this role</h2><form><input name="email"><input type="file" name="TheCV"><button>Submit application</button></form>';
    await page.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!route.request().url().startsWith("https://www.ir35careers.com/testing/")) {
        await route.abort();
        return;
      }
      if (path === "/testing/cookie") {
        cookiesRejected = true;
        // A browser navigation keeps both destinations intercepted. An HTTP
        // redirect would let Playwright follow its target outside this route.
        await route.fulfill({ contentType: "text/html", body: '<script>document.cookie="optionalCookies=rejected";location.replace("/testing/jobs")</script>' });
      } else if (path === "/testing/jobs") {
        await route.fulfill({ contentType: "text/html", body: `<h1>Different role</h1>${redirectedPageHasForm ? form : '<p>Latest jobs</p>'}` });
      } else {
        await route.fulfill({ contentType: "text/html", body: `<h1>Controlled original role</h1>${cookiesRejected ? "" : '<a href="/testing/cookie">Decline All</a>'}${form}` });
      }
    });
    await page.goto(destination);
    const stages: string[] = [];
    const result = await openApplicationForm(page, detectAts(destination), stages);
    expect(cookiesRejected).toBe(true);
    expect(result.url()).toBe(destination);
    await expect(result.getByRole("heading", { name: "Controlled original role" })).toBeVisible();
    expect(stages).toContain("Cookie redirect restored /testing/legacy-cookie-form; application form true");
  });
}
