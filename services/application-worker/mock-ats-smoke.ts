import { createServer } from "node:http";
import { once } from "node:events";
import { chromium } from "playwright-core";
import { z } from "zod";

async function smoke() {
  if (["PG_BOSS_DATABASE_URL", "SUPABASE_SECRET_KEY", "APPLICATION_WORKER_SECRET", "CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL"].some(name => Boolean(process.env[name])))
    throw new Error("Mock smoke refuses a credential-bearing worker environment.");
  const input = z.strictObject({ name: z.literal("Controlled browser check"), approved: z.literal(true) });
  let submissions = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }).end(`<!doctype html><html lang="en-GB"><meta charset="utf-8"><title>IR35 mock ATS only</title><main><h1>Controlled mock application</h1><form><label>Name<input name="name" required></label><label><input name="approved" type="checkbox" required>I approve this mock only</label><button>Submit mock application</button></form><p role="status"></p></main><script>document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const result=await fetch('/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:form.get('name'),approved:form.has('approved')})});document.querySelector('[role=status]').textContent=result.ok?'Mock receipt confirmed':'Mock failed';});</script></html>`);
      return;
    }
    if (request.method === "POST" && request.url === "/submit") {
      try {
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 1024) { response.writeHead(413).end(); return; }
          chunks.push(Buffer.from(chunk));
        }
        input.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        submissions++;
        response.writeHead(submissions === 1 ? 200 : 409, { "content-type": "application/json" }).end(JSON.stringify({ mock: true }));
      } catch { response.writeHead(400).end(); }
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock server did not start.");
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({ serviceWorkers: "block" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(origin);
    await page.getByLabel("Name", { exact: true }).fill("Controlled browser check");
    await page.getByLabel("I approve this mock only").check();
    await page.getByRole("button", { name: "Submit mock application" }).click();
    await page.getByRole("status").filter({ hasText: "Mock receipt confirmed" }).waitFor();
    if (submissions !== 1) throw new Error("Expected exactly one mock receipt.");
    console.info(JSON.stringify({ mock: true, browserReady: true, receiptConfirmed: true, submissions, architecture: process.arch }));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const deadline = setTimeout(() => { console.error("Isolated mock ATS smoke timed out."); process.exit(1); }, 60_000).unref();
void smoke().then(() => clearTimeout(deadline)).catch(() => { clearTimeout(deadline); console.error("Isolated mock ATS smoke failed. No real application or credentials were used."); process.exit(1); });
