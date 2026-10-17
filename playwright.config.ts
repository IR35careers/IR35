import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const productionTest = Boolean(process.env.CI) || process.env.PLAYWRIGHT_PRODUCTION === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    // Use the Playwright-version-pinned Chromium, not a drifting system Chrome.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  expect: { timeout: 15_000 },
  webServer: {
    command: productionTest ? "npm run build && npm run start" : "npm run dev",
    // Developer production env files must not connect preview tests to real
    // candidate data or turn the local workspace into an authenticated client.
    env: {
      IR35CAREERS_E2E_DEMO_DATA: "1",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SECRET_KEY: "",
      APPLICATION_WORKER_SECRET: "",
    },
    url: baseURL,
    reuseExistingServer: !productionTest,
    timeout: productionTest ? 900_000 : 120_000,
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "tablet-chrome",
      use: { viewport: { width: 768, height: 1024 } },
    },
    {
      name: "desktop-chrome",
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
