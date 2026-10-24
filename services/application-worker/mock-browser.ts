/** Isolated child: NEVER inherits queue, HMAC, Supabase or provider credentials. */
import { createServer } from "node:http";
import { once } from "node:events";
import { chromium } from "playwright-core";
import { z } from "zod";
import { mkdir } from "node:fs/promises";

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
  let submissions = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      const blocked = value.scenario === "captcha" ? "CAPTCHA requires a human" : value.scenario === "unknown_answer" ? "Unknown answer requires review" : "";
      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }).end(`<!doctype html><html lang="en-GB"><title>Isolated IR35 mock ATS</title><main><h1>Mock application only</h1><p>${blocked}</p><form><label>Name<input name="name" required></label><label><input name="approved" type="checkbox" required>Approved mock only</label><button>Submit mock</button></form><p role="status"></p></main><script>document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();try{const r=await fetch('/submit',{method:'POST'});document.querySelector('[role=status]').textContent=r.ok?'Mock receipt confirmed':'Mock HTTP error';}catch{document.querySelector('[role=status]').textContent='Mock outcome unknown';}})</script></html>`); return;
    }
    if (request.method === "POST" && request.url === "/submit") {
      submissions++;
      if (value.scenario === "timeout") return;
      if (value.scenario === "lost_ack") { response.destroy(); return; }
      response.writeHead(value.scenario === "server_error" ? 500 : submissions === 1 ? 200 : 409).end(); return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback mock unavailable.");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    await page.goto(origin);
    if (value.scenario === "captcha" || value.scenario === "unknown_answer") return { ok: false, errorCode: value.scenario === "captcha" ? "mock_captcha_required" : "mock_input_required", submissions };
    await page.getByLabel("Name", { exact: true }).fill("IR35 controlled test contractor");
    await page.getByLabel("Approved mock only").check(); await page.getByRole("button", { name: "Submit mock", exact: true }).click();
    await page.getByRole("status").filter({ hasText: /Mock receipt confirmed|Mock HTTP error|Mock outcome unknown/ }).waitFor();
    const status = await page.getByRole("status").textContent();
    if (status === "Mock receipt confirmed" && submissions === 1) return { ok: true, receiptConfirmed: true, submissions };
    return { ok: false, errorCode: status === "Mock HTTP error" ? "mock_ats_http_500" : "mock_unknown_outcome", submissions };
  } catch { return { ok: false, errorCode: "mock_ats_timeout", submissions }; }
  finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const deadline = setTimeout(() => process.exit(1), 60_000).unref();
void main().then(result => { clearTimeout(deadline); console.log(JSON.stringify(result)); })
  .catch(() => { clearTimeout(deadline); console.log(JSON.stringify({ ok: false, errorCode: "mock_browser_failed", submissions: 0 })); process.exitCode = 1; });
