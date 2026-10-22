import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { spawn } from "node:child_process";
import { cacheableHomepage, hashedPublicPolicy, HomepageCache } from "./public-html";

const host = process.env.IR35_WEB_HOST;
if (host !== "staging.ir35careers.com") throw new Error("P5 web launcher is staging-only");
const origin = `https://${host}`;
const enabled = process.env.IR35_PUBLIC_HTML_CACHE === "true" && process.env.IR35_READ_ONLY === "false";
const cache = new HomepageCache();
const child = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "3001", NODE_OPTIONS: "--max-old-space-size=1024" },
  // Framework errors may include private DB configuration. Diagnostics are
  // explicit redacted probes, never raw vendor stdout/stderr persisted in Docker.
  stdio: "ignore",
});
child.on("error", () => { process.exitCode = 1; server.close(); });
child.on("exit", () => { server.close(); });

const server = createServer((request, response) => {
  if (request.headers.host?.split(":")[0] !== host && request.headers.host !== "127.0.0.1:3000") {
    response.writeHead(421, { "cache-control": "no-store" }).end(); return;
  }
  const eligible = cacheableHomepage(request.method ?? "", request.url ?? "", request.headers, enabled);
  const hit = eligible ? cache.get() : null;
  if (hit) {
    response.writeHead(200, { ...hit.headers, "x-ir35-html-cache": "HIT", age: String(Math.floor((Date.now() - hit.created) / 1000)) }).end(hit.body);
    return;
  }
  const headers: IncomingHttpHeaders = eligible
    ? { host, accept: "text/html", "accept-encoding": "identity" }
    : { ...request.headers, host, "accept-encoding": "identity" };
  delete headers["x-nonce"];
  delete headers["content-security-policy"];
  const upstream = httpRequest({ host: "127.0.0.1", port: 3001, method: request.method, path: request.url, headers }, incoming => {
    const outgoing = { ...incoming.headers };
    delete outgoing["transfer-encoding"];
    const publicHTML = eligible && incoming.statusCode === 200 && !outgoing["set-cookie"] && !outgoing["content-encoding"]
      && outgoing["content-type"]?.startsWith("text/html");
    if (!publicHTML) {
      response.writeHead(incoming.statusCode ?? 502, outgoing);
      incoming.pipe(response); return;
    }
    const chunks: Buffer[] = []; let bytes = 0;
    incoming.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4_000_000) { incoming.destroy(); response.writeHead(502, { "cache-control": "no-store" }).end(); }
      else chunks.push(chunk);
    });
    incoming.on("end", () => {
      if (response.destroyed || response.writableEnded) return;
      const body = Buffer.concat(chunks);
      try {
        outgoing["content-security-policy"] = hashedPublicPolicy(body.toString("utf8"), String(outgoing["content-security-policy"] ?? ""), origin);
        outgoing["cache-control"] = "public, max-age=0, s-maxage=60, must-revalidate";
        outgoing["vary"] = "Accept-Encoding";
        outgoing["content-length"] = String(body.length);
        delete outgoing.etag;
        cache.put(body, outgoing);
        outgoing["x-ir35-html-cache"] = "MISS";
      } catch {
        outgoing["cache-control"] = "no-store";
        outgoing["x-ir35-html-cache"] = "BYPASS";
      }
      response.writeHead(200, outgoing).end(body);
    });
    incoming.on("error", () => response.destroy());
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(503, { "cache-control": "no-store" });
    response.end();
  });
  upstream.setTimeout(300_000, () => upstream.destroy());
  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
});
server.listen(3000, "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { child.kill(signal); server.close(); });
