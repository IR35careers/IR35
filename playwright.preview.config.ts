import { defineConfig, devices } from "@playwright/test";
import { z } from "zod";

const raw = z.url().parse(process.env.BOT_PREVIEW_URL);
const origin = new URL(raw);
const local = process.env.BOT_PREVIEW_LOCAL === "1" && process.env.GITHUB_ACTIONS !== "true"
  && origin.protocol === "http:" && origin.hostname === "127.0.0.1";
if (!local && (origin.protocol !== "https:" || !/^ir35-bot-preview-[a-z0-9-]+\.vercel\.app$/.test(origin.hostname) || origin.port))
  throw new Error("Only the isolated bot preview URL is allowed.");
if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Invalid preview origin.");

export default defineConfig({
  testDir: "./tests/preview",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: 0, // Report once; no retry loop on a failed bot handoff.
  forbidOnly: true,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: origin.origin, serviceWorkers: "block", ignoreHTTPSErrors: false, navigationTimeout: 30_000 },
  projects: [
    { name: "preview-desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "preview-mobile", use: { ...devices["Pixel 7"] } },
  ],
  // Intentionally NO webServer: never replace a missing Vercel preview with a
  // local server and then report it passed.
});
