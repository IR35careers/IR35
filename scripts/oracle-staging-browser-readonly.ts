/** Real headed browser + actual staging GETs. No demo backend or write flow. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, closeSync, fsyncSync, writeFileSync, readFileSync, readdirSync, lstatSync, realpathSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { z } from "zod";
import { allowStagingRead, safeBrowserFailure, stagingBrowserBootstrap, stagingReadHeaders, STAGING_BROWSER_ORIGIN as origin } from "../services/application-worker/staging-browser-policy";

const nativeRoot = "C:\\Users\\anves\\.codex\\worktrees\\bot-handoff\\ir35careers";
const wslRoot = "/mnt/c/Users/anves/.codex/worktrees/bot-handoff/ir35careers";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export class BrowserJournal {
  private hashes = new Map<string, string>();
  private closed = false;
  constructor(readonly root: string) {
    if (realpathSync(dirname(root)) !== resolve(dirname(root))) throw new Error("ControlledEvidenceParentRequired");
    mkdirSync(root);
  }
  put(name: string, value: unknown) {
    if (this.closed || !/^[a-z0-9-]+\.json$/.test(name)) throw new Error("ClosedOrUnsafeEvidenceName");
    if (readdirSync(this.root).sort().join("|") !== [...this.hashes.keys()].sort().join("|")) throw new Error("ArtifactSetChanged");
    for (const [file, digest] of this.hashes) {
      const path = resolve(this.root, file); const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || sha(readFileSync(path)) !== digest) throw new Error("ArtifactChanged");
    }
    const serialized = JSON.stringify(value, null, 2);
    if (typeof serialized !== "string") throw new Error("StructuredEvidenceRequired");
    const bytes = serialized + "\n";
    const fd = openSync(resolve(this.root, name), "wx", 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    this.hashes.set(name, sha(bytes));
  }
  seal(result: unknown) {
    this.put("result.json", result);
    this.put("manifest.json", { version: 1, artifacts: [...this.hashes].map(([name, sha256]) => ({ name, sha256 })) });
    this.closed = true;
    return this.hashes.get("manifest.json");
  }
}

async function bridge(operation: "source_context" | "private_bootstrap" | "full_containment", data?: unknown): Promise<unknown> {
  // The public Python program is argv; payload is stdin; outputs stay in RAM.
  // Raw child stdout/stderr and Playwright errors are NEVER logged or saved.
  const program = `import sys,json\nsys.path.insert(0,'infra/oracle')\nimport p8_browser_bridge as b\ntry:\n value=b.${operation}(${operation === "source_context" ? "" : "json.loads(sys.stdin.read(16000001))"})\n print(json.dumps(value))\nexcept Exception as e:\n print(json.dumps({'status':'STOP','code':'ReadonlyBrowserBridgeStopped','errorType':type(e).__name__}));sys.exit(1)\n`;
  return new Promise((done, reject) => {
    const child = spawn("wsl.exe", ["-d", "Ubuntu", "--cd", wslRoot, "-e", "/home/anvesh/.ir35/oci/bin/python", "-c", program],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = Buffer.alloc(0); let errorBytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error("ReadonlyBridgeDeadline")); }, operation === "full_containment" ? 660_000 : 150_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > 16_000_000) { child.kill(); reject(new Error("ReadonlyBridgeResponseBound")); }
    });
    child.stderr.on("data", (chunk: Buffer) => { errorBytes += chunk.length; });
    child.on("error", () => { clearTimeout(timer); reject(new Error("ReadonlyBridgeLaunchFailed")); });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (status !== 0 || errorBytes !== 0) { stdout.fill(0); reject(new Error("ReadonlyBridgeFailed_RawOutputWithheld")); return; }
      try { const result: unknown = JSON.parse(stdout.toString()); stdout.fill(0); done(result); }
      catch { stdout.fill(0); reject(new Error("ReadonlyBridgeInvalidJSON")); }
    });
    child.stdin.on("error", () => reject(new Error("ReadonlyBridgeInputClosed")));
    child.stdin.end(data === undefined ? "" : JSON.stringify(data));
  });
}

export async function runProtectedBrowser() {
  if (process.platform !== "win32" || resolve(process.cwd()) !== resolve(nativeRoot) || process.argv.slice(2).join(" ") !== "--read-only") throw new Error("FixedNativeReadonlyInvocationRequired");
  // No inherited diagnostic flag may cause headers/credentials to be logged.
  for (const name of ["DEBUG", "PWDEBUG", "DEBUG_FILE"]) delete process.env[name];
  const root = resolve(nativeRoot, "docs/evidence/p8/browser-readonly-01");
  if (existsSync(root)) throw new Error("BrowserReadonlySlotUsed_NoReplay");
  let journal: BrowserJournal | undefined; let context: BrowserContext | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let data: unknown; let result: Record<string, unknown> = { status: "FAIL", readOnly: true, phaseComplete: false, productionChanges: false };
  let activeCase = "source-context";
  const blocked: { method: string; destinationSHA256: string }[] = [];
  const serverReads: { method: string; routeSHA256: string; status: number; type: string }[] = [];
  const pageErrorHashes: string[] = []; let rejectedRedirects = 0; let webSockets = 0;
  try {
    data = z.record(z.string(), z.unknown()).parse(await bridge("source_context")); // Existing committed-clean guard; no VM call.
    journal = new BrowserJournal(root);
    journal.put("intent.json", { headed: true, ephemeralContext: true, demoBackend: false, methods: ["GET"],
      exactOrigin: origin, serviceWorkers: "block", webSockets: "block", snapshotsOrTraces: false,
      credentialCustody: "RAM-only stdin/SSH IPC; existing VM Basic credential; no new value", sourceCleanVerified: true });
    journal.put("bootstrap-intent.json", { operation: "readonly-existing-basic-bootstrap", vmWrites: 0 });
    activeCase = "bootstrap";
    const parsed = stagingBrowserBootstrap.safeParse(await bridge("private_bootstrap", data));
    if (!parsed.success) throw new Error("ReadonlyBrowserBootstrapInvalid");
    const basic = Buffer.from(parsed.data.username + ":" + parsed.data.password).toString("base64");
    parsed.data.password = "";
    journal.put("bootstrap-result.json", { status: "PASS", readOnly: true, mockOnly: true, realAcceptance: false, smtpSink: true, credentialValuesPrinted: false });
    activeCase = "headed-browser-launch";
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block", acceptDownloads: false });
    context.setDefaultTimeout(15_000); context.setDefaultNavigationTimeout(60_000);
    await context.routeWebSocket("**/*", (socket) => { webSockets++; socket.close(); });
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (!allowStagingRead({ method: request.method(), url: request.url() })) {
        blocked.push({ method: request.method(), destinationSHA256: sha(request.url()) });
        await route.abort("blockedbyclient"); return;
      }
      if (serverReads.length > 600) { await route.abort(); return; }
      try {
        // Zero auto-follow: reject redirects BEFORE any external contact.
        const reply = await route.fetch({ maxRedirects: 0, maxRetries: 0,
          headers: stagingReadHeaders(request.url(), await request.allHeaders(), basic) });
        serverReads.push({ method: request.method(), routeSHA256: sha(new URL(request.url()).pathname), status: reply.status(), type: request.resourceType() });
        if (reply.status() >= 300 && reply.status() < 400) { rejectedRedirects++; await route.abort("blockedbyclient"); return; }
        await route.fulfill({ response: reply });
      } catch { await route.abort("failed").catch(() => undefined); }
    });
    await context.addInitScript(() => { localStorage.setItem("ir35careers:cookie-consent:v1", "essential"); });
    const page = await context.newPage();
    page.on("pageerror", (error) => { pageErrorHashes.push(sha(error.message)); });
    const cases: { name: string; path: string }[] = [
      { name: "jobs", path: "/jobs" }, { name: "ir35-tool", path: "/tools/ir35-status" },
      { name: "take-home", path: "/tools/take-home" }, { name: "account", path: "/account" },
    ];
    let jobPath: string | undefined;
    for (const [index, item] of cases.entries()) {
      activeCase = item.name;
      journal.put(`case-${index}-intent.json`, { name: item.name, method: "GET", path: item.path, expected: { status: 200, h1: 1, noindex: true, noStore: true, csp: true, overflow: false } });
      const response = await page.goto(origin + item.path, { waitUntil: "networkidle" });
      const headers = response ? await response.allHeaders() : {};
      const h1 = await page.locator("h1").count();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const observation = { name: item.name, status: response?.status(), h1, overflow,
        noindex: /noindex/.test(headers["x-robots-tag"] ?? ""), noStore: /no-store/.test(headers["cache-control"] ?? ""),
        csp: Boolean(headers["content-security-policy"]), sameOrigin: new URL(page.url()).origin === origin };
      journal.put(`case-${index}-result.json`, observation);
      if (observation.status !== 200 || h1 !== 1 || overflow || !observation.noindex || !observation.noStore || !observation.csp || !observation.sameOrigin) throw new Error("ReadonlyPageGateFailed");
      if (item.name === "jobs") {
        const ssrJobLinks = /href="\/jobs\/[a-f0-9-]{36}"/.test(await response!.text());
        journal.put("ssr-jobs-result.json", { status: ssrJobLinks ? "PASS" : "FAIL", jobAnchorsInServerHTML: ssrJobLinks, htmlPrinted: false });
        if (!ssrJobLinks) throw new Error("ServerHTMLJobLinksRequired");
        const links = await page.locator('a[href^="/jobs/"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
        jobPath = links.find((path): path is string => /^\/jobs\/[a-f0-9-]{36}$/.test(path ?? ""));
        if (!jobPath) throw new Error("SSRJobLinkMissing");
        const search = page.getByRole("searchbox", { name: "Search contracts", exact: true });
        const pending = page.waitForResponse((reply) => new URL(reply.url()).pathname === "/api/jobs/search"
          && new URL(reply.url()).searchParams.get("q") === "zzir35p8readonlynomatch27" && reply.status() === 200);
        await search.fill("zzir35p8readonlynomatch27");
        const filtered: unknown = await (await pending).json();
        const valid = z.object({ jobs: z.array(z.unknown()).max(0), total: z.literal(0) }).safeParse(filtered);
        journal.put("search-filter-result.json", { status: valid.success ? "PASS" : "FAIL", realBackend: true, emptyResultVerified: valid.success });
        if (!valid.success) throw new Error("ActualEmptyFilterResultRequired");
      }
    }
    activeCase = "job-detail";
    journal.put("job-detail-intent.json", { method: "GET", pathSHA256: sha(jobPath ?? ""), expectedStatus: 200, expectedH1: 1 });
    const job = await page.goto(origin + jobPath, { waitUntil: "networkidle" });
    const jobGate = { status: job?.status(), h1: await page.locator("h1").count(), sameOrigin: new URL(page.url()).origin === origin };
    journal.put("job-detail-result.json", jobGate);
    if (jobGate.status !== 200 || jobGate.h1 !== 1 || !jobGate.sameOrigin) throw new Error("ActualJobDetailRequired");
    const cookies = (await context.cookies()).filter((cookie) => cookie.name === "__Host-ir35-staging");
    journal.put("cookie-result.json", { count: cookies.length, secure: cookies[0]?.secure, httpOnly: cookies[0]?.httpOnly, sameSite: cookies[0]?.sameSite, path: cookies[0]?.path, valuesPrinted: false });
    if (cookies.length !== 1 || !cookies[0].secure || !cookies[0].httpOnly || cookies[0].sameSite !== "Strict" || cookies[0].path !== "/") throw new Error("ExistingSecureGateCookieRequired");
    if (rejectedRedirects || pageErrorHashes.length || serverReads.length > 600 || !serverReads.some((read) => read.type === "script" && read.status === 200) || !serverReads.some((read) => read.type === "stylesheet" && read.status === 200)) throw new Error("BrowserAssetOrRuntimeGateFailed");
    result = { ...result, status: "PASS", browserVersion: browser.version(), pageCases: cases.length + 1, actualSearchFilter: true, screenshotsOrTraces: false, mutationsSent: 0, googleProof: false, authenticatedWriteProof: false };
  } catch (error) {
    result = { ...result, ...safeBrowserFailure(error) };
    if (!journal) journal = new BrowserJournal(root);
    journal.put("failure.json", { ...safeBrowserFailure(error), activeCase, rawErrorWithheld: true });
  } finally {
    await context?.close().catch(() => undefined); await browser?.close().catch(() => undefined);
    if (journal) {
      journal.put("network-summary.json", { serverReads, blocked, rejectedRedirects, webSocketsBlocked: webSockets, pageErrorHashes, rawHeadersOrMessagesPrinted: false });
      if (data !== undefined) {
        journal.put("containment-intent.json", { operation: "full-original-containment", vmWrites: 0 });
        try {
          const full: unknown = await bridge("full_containment", data);
          journal.put("containment-result.json", full);
          if (!z.object({ status: z.literal("PASS") }).safeParse(full).success) result = { ...result, status: "FAIL", code: "FullContainmentFailed_HardStop" };
        } catch { result = { ...result, status: "FAIL", code: "FullContainmentUnconfirmed_HardStop" }; }
      }
      const manifestSHA256 = journal.seal(result);
      console.log(JSON.stringify({ ...result, manifestSHA256 }));
    }
  }
  if (result.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/oracle-staging-browser-readonly.ts")) {
  void runProtectedBrowser().catch(() => { console.log(JSON.stringify({ status: "STOP", code: "ReadonlyBrowserControllerStopped_RawOutputWithheld" })); process.exitCode = 1; });
}
