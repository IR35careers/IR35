/** Isolated child: NEVER inherits queue, HMAC, Supabase or provider credentials. */
import { once } from "node:events";
import { chromium } from "playwright-core";
import { z } from "zod";
import { mkdir } from "node:fs/promises";
import { mockATS } from "./mock-ats";

const command = z.strictObject({ operation: z.enum(["health", "apply"]),
  scenario: z.enum(["success", "server_error", "timeout", "lost_ack", "captcha", "unknown_answer"]).optional() });
async function main() {
  if (Object.keys(process.env).some(key => /^(?:PG|SUPABASE|APPLICATION_WORKER_SECRET|CRON_SECRET|STRIPE|POSTMARK|OPENAI)/.test(key))) throw new Error("Credential-bearing browser environment refused.");
  let input = "";
  for await (const part of process.stdin) { input += part; if (Buffer.byteLength(input) > 512) throw new Error("Bounded mock command required."); }
  const value = command.parse(JSON.parse(input));
  if (process.env.HOME === "/tmp/ir35-home") await mkdir(process.env.HOME, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  if (value.operation === "health") { await browser.close(); return { ok: true, browserReady: true, submissions: 0 }; }
  if (!value.scenario) throw new Error("Explicit mock scenario required.");
  const { server, submissions } = mockATS(value.scenario);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback mock unavailable.");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    await page.goto(origin);
    if (value.scenario === "captcha" || value.scenario === "unknown_answer") return { ok: false, errorCode: value.scenario === "captcha" ? "mock_captcha_required" : "mock_input_required", submissions: submissions() };
    await page.getByLabel("Name", { exact: true }).fill("IR35 controlled test contractor");
    await page.getByLabel("Approved mock only").check(); await page.getByRole("button", { name: "Submit mock", exact: true }).click();
    await page.getByRole("status").filter({ hasText: /Mock receipt confirmed|Mock HTTP error|Mock outcome unknown/ }).waitFor();
    const status = await page.getByRole("status").textContent();
    if (status === "Mock receipt confirmed" && submissions() === 1) return { ok: true, receiptConfirmed: true, submissions: submissions() };
    return { ok: false, errorCode: status === "Mock HTTP error" ? "mock_ats_http_500" : "mock_unknown_outcome", submissions: submissions() };
  } catch { return { ok: false, errorCode: "mock_ats_timeout", submissions: submissions() }; }
  finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const deadline = setTimeout(() => process.exit(1), 60_000).unref();
void main().then(result => { clearTimeout(deadline); console.log(JSON.stringify(result)); })
  .catch(() => { clearTimeout(deadline); console.log(JSON.stringify({ ok: false, errorCode: "mock_browser_failed", submissions: 0 })); process.exitCode = 1; });
