/** Concrete UI journeys for the OWNED disposable fixture, not a deployment CLI.
 * Default is source-only/dry-run. The native fixture/sink/ledger launcher is not
 * wired yet; a JSON claim is never an attestation. No real password, provider,
 * fulfilled response, storage-state file, screenshot, trace or TLS bypass.
 */
import { createHash, randomBytes } from "node:crypto";
import { chromium, type Browser, type Page, type Response } from "playwright-core";
import { z } from "zod";
import { createQaContext } from "./oracle-qa-browser-context";
import { QA_ORIGIN } from "./oracle-qa-transport";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceSha = z.string().regex(/^[a-f0-9]{40}$/);
export const QA_ACCOUNT = "anvesh.mannuru+ir35test@gmail.com";
export const QA_JOB_IDS = Object.freeze(Array.from({ length: 6 }, (_, index) => `00000000-0000-4000-8000-00000000a00${index + 1}`));
const failures = [null, "mock_ats_http_500", "mock_ats_timeout", "mock_unknown_outcome", "mock_captcha_required", "mock_input_required"] as const;
const failureText = "Isolated mock ATS did not confirm submission. No employer was contacted.";
const image = z.strictObject({ sourceSHA: sourceSha, digest: z.string().regex(/^sha256:[a-f0-9]{64}$/) });

export const browserWriteBinding = z.strictObject({
  version: z.literal(1), scope: z.literal("OWNED_DISPOSABLE_STAGING_ONLY"),
  slot: z.string().regex(/^writable-qa-[0-9]{8}t[0-9]{6}z-[a-f0-9]{8}$/), sourceSHA: sourceSha,
  fixture: z.literal("webqa01"), origin: z.literal(QA_ORIGIN), account: z.literal(QA_ACCOUNT),
  database: z.string().regex(/^ir35_p4_[0-9]{8}t[0-9]{6}z_[a-f0-9]{8}_p8_webqa01$/),
  tunnel: z.strictObject({ host: z.literal("127.0.0.1"), port: z.number().int().min(1024).max(65535), fixture: z.literal("webqa01") }),
  images: z.strictObject({ web: image, worker: image }),
  baselineManifestSHA256: sha256, fixtureManifestSHA256: sha256,
  originalRuntimeReadOnly: z.literal(true), cloneHbaDenials: z.literal(8),
  applyRunner: z.literal("mock"), smtpSink: z.literal(true), acceptJobs: z.literal(false),
  liveProvidersConfigured: z.literal(false), publicPorts: z.literal(0),
  credentials: z.strictObject({ username: z.literal("ir35"), password: z.string().regex(/^[a-f0-9]{48}$/) }),
}).superRefine((value, ctx) => {
  if (value.images.web.sourceSHA !== value.sourceSHA || value.images.worker.sourceSHA !== value.sourceSHA)
    ctx.addIssue({ code: "custom", message: "One attested source required" });
});
export type BrowserWriteBinding = z.infer<typeof browserWriteBinding>;

export class WriteQaError extends Error {
  constructor(code: string) { super(/^[A-Za-z0-9_]{1,120}$/.test(code) ? code : "WriteQaErrorWithheld"); }
}
export function parseWriteBinding(value: unknown): BrowserWriteBinding {
  const parsed = browserWriteBinding.safeParse(value);
  if (!parsed.success) throw new WriteQaError("OwnedPrivateMockRuntimeBindingRequired");
  return parsed.data;
}

/** Read only explicitly supplied stdin. Never use a file/env/argv for values. */
export async function readWriteBinding(input: AsyncIterable<Uint8Array>): Promise<BrowserWriteBinding> {
  const chunks: Buffer[] = []; let length = 0;
  try {
    for await (const chunk of input) {
      if (!(chunk instanceof Uint8Array)) throw new WriteQaError("BoundedRuntimeStdinRequired");
      const owned = Buffer.from(chunk); chunks.push(owned); length += owned.length;
      if (length > 32_768) throw new WriteQaError("BoundedRuntimeStdinRequired");
    }
    const body = Buffer.concat(chunks);
    try { return parseWriteBinding(JSON.parse(body.toString("utf8"))); }
    finally { body.fill(0); }
  } catch { throw new WriteQaError("InvalidPrivateRuntimeStdin_RawWithheld"); }
  finally { for (const chunk of chunks) chunk.fill(0); }
}

/** Only a fresh private sink link, never a real inbox/provider link. The exact
 * API-staging prefix is routed to the SAME owned private Kong through Caddy.
 * Returned token-bearing URL is RAM-only; caller must never journal it.
 */
export function privateSinkLink(value: unknown, kind: "recovery" | "magiclink"): string {
  if (typeof value !== "string" || value.length > 4096 || /[\\\r\n\0]/.test(value)) throw new WriteQaError("PrivateSinkLinkRejected");
  try {
    const url = new URL(value);
    if (url.origin !== "https://api-staging.ir35careers.com" || url.username || url.password || url.hash
      || url.pathname !== "/auth/v1/verify" || [...url.searchParams.keys()].some(key => !["token", "type", "redirect_to"].includes(key))
      || url.searchParams.getAll("token").length !== 1 || !/^[a-f0-9]{56}$/.test(url.searchParams.get("token") ?? "")
      || url.searchParams.getAll("type").length !== 1 || url.searchParams.get("type") !== kind
      || url.searchParams.getAll("redirect_to").length !== 1) throw new Error();
    const redirect = new URL(url.searchParams.get("redirect_to")!);
    const next = redirect.searchParams.get("next");
    if (redirect.origin !== QA_ORIGIN || redirect.username || redirect.password || redirect.hash
      || redirect.pathname !== "/auth/callback" || [...redirect.searchParams.keys()].some(key => key !== "next")
      || redirect.searchParams.getAll("next").length !== 1
      || next !== (kind === "recovery" ? "/account/reset" : "/dashboard")) throw new Error();
    return QA_ORIGIN + "/supabase/auth/v1/verify?" + url.searchParams.toString();
  } catch { throw new WriteQaError("PrivateSinkLinkRejected"); }
}

export const persistedMockProof = z.strictObject({
  jobId: z.enum(QA_JOB_IDS as [string, ...string[]]), applicationId: z.uuid(),
  status: z.enum(["submitted", "failed"]), failure: z.string().nullable(),
  mockReceipts: z.number().int().min(0).max(1), browserAttempts: z.literal(1),
  realEmailMessages: z.literal(0), employerPayloads: z.literal(0),
  queueAcknowledged: z.literal(true),
});
export function checkPersistedMock(value: unknown, index: number) {
  const parsed = persistedMockProof.safeParse(value);
  if (!parsed.success || index < 0 || index > 5 || parsed.data.jobId !== QA_JOB_IDS[index]
    || parsed.data.status !== (index === 0 ? "submitted" : "failed")
    || parsed.data.failure !== failures[index] || parsed.data.mockReceipts !== (index === 0 ? 1 : 0))
    throw new WriteQaError("ExactPersistedMockOutcomeRequired_NoReadyFallback");
  return parsed.data;
}

export interface WriteQaJournal { put(name: string, value: unknown): void }
export interface OwnedQaNativeBindings {
  /** Must independently verify sealed source/image/ownership/tunnel/memory and
   * original containment proof against the VM. Input booleans are NOT proof. */
  attest(binding: BrowserWriteBinding): Promise<{ sourceSHA: string; slot: string; fixtureManifestSHA256: string; verified: true }>;
  /** Read ONLY this owned sink, enforce named recipient/fresh message/one token,
   * and respect the real shared mail cooldown. Never reset a rate-limit timer. */
  sinkLink(kind: "recovery" | "magiclink"): Promise<string>;
  /** Actual GoTrue OTP call on the private owned fixture; there is NO UI button. */
  requestMagicLink(): Promise<{ accepted: true; accountVerified: true; smtpSink: true }>;
  /** Actual independent SQL/queue/receipt observation, not a supplied expected row. */
  terminal(jobId: string): Promise<unknown>;
}

function requireNativeBindings(value: OwnedQaNativeBindings | undefined): asserts value is OwnedQaNativeBindings {
  if (!value || [value.attest, value.sinkLink, value.requestMagicLink, value.terminal].some(item => typeof item !== "function"))
    throw new WriteQaError("ConcretePrivateQaBackendBindingsMissing_NoBrowserStarted");
}

export async function closeWriteBrowser(owned: { close(): Promise<void> } | undefined,
  browser: Pick<Browser, "close"> | undefined, credentials: BrowserWriteBinding["credentials"]) {
  let failed = false;
  // createQaContext's per-request header guard retains this RAM object. Do not
  // clear it while the context is still alive, or every actual request fails.
  try { await owned?.close(); } catch { failed = true; }
  try { await browser?.close(); } catch { failed = true; }
  credentials.password = "";
  if (failed) throw new WriteQaError("OwnedBrowserCleanupFailed_RawWithheld");
}

async function pageGate(page: Page, path: string, heading = true) {
  const reply = await page.goto(QA_ORIGIN + path, { waitUntil: "networkidle" });
  const headers = reply ? await reply.allHeaders() : {};
  if (reply?.status() !== 200 || new URL(page.url()).origin !== QA_ORIGIN
    || !/no-store/.test(headers["cache-control"] ?? "") || !/noindex/.test(headers["x-robots-tag"] ?? "")
    || !headers["content-security-policy"] || (heading && await page.locator("h1").count() !== 1))
    throw new WriteQaError("ActualProtectedPageGateFailed");
}

function observeResponse(page: Page, predicate: (reply: Response) => boolean) {
  const pending = page.waitForResponse(predicate);
  // If the UI action fails first, keep a later response timeout from becoming
  // an unhandled raw Playwright error outside the sealed/sanitised case.
  void pending.catch(() => undefined);
  return pending;
}

/** Real Playwright selectors come from sign-in-form.tsx, account/reset,
 * SaveJobButton and ApplicationRecordWorkspace. Never retry a submit. Native
 * owner remains responsible for unconditional fixture cleanup/full containment.
 * This function is NOT called by the default CLI, CI or unit tests.
 */
export async function runOwnedBrowserJourneys(input: unknown, native: OwnedQaNativeBindings | undefined, journal: WriteQaJournal) {
  const binding = parseWriteBinding(input);
  requireNativeBindings(native); // BEFORE attestation, browser, private/network I/O.
  let verified: Awaited<ReturnType<OwnedQaNativeBindings["attest"]>>;
  try { verified = await native.attest(binding); }
  catch { throw new WriteQaError("ActualPrivateFixtureAttestationRequired"); }
  if (verified?.verified !== true || verified.sourceSHA !== binding.sourceSHA || verified.slot !== binding.slot
    || verified.fixtureManifestSHA256 !== binding.fixtureManifestSHA256) throw new WriteQaError("ActualPrivateFixtureAttestationRequired");
  for (const key of ["DEBUG", "PWDEBUG", "DEBUG_FILE"]) delete process.env[key];
  let browser: Browser | undefined;
  let owned: Awaited<ReturnType<typeof createQaContext>> | undefined;
  let current = "launch";
  const cases: { name: string; status: "PASS" }[] = [];
  const password = randomBytes(48).toString("base64url"); // Disposable clone only, never original password.
  const record = async (name: string, operation: () => Promise<void>) => {
    current = name; journal.put(`${name}-intent.json`, { operation: name, retryAllowed: false });
    try {
      await operation(); cases.push({ name, status: "PASS" });
      journal.put(`${name}-result.json`, { status: "PASS", actualServerResponses: true, rawValuesPrinted: false });
    } catch {
      journal.put(`${name}-result.json`, { status: "FAIL", code: "ActualBrowserJourneyFailed_RawWithheld" });
      throw new WriteQaError("ActualBrowserJourneyFailed_RawWithheld");
    }
  };
  try {
    browser = await chromium.launch({ headless: false });
    owned = await createQaContext(browser, binding.tunnel, binding.credentials);
    const page = await owned.context.newPage();
    page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(60_000);
    await owned.context.addInitScript(() => localStorage.setItem("ir35careers:cookie-consent:v1", "essential"));
    await record("recovery", async () => {
      await pageGate(page, "/account");
      await page.getByRole("button", { name: "Forgot your password?", exact: true }).click();
      await page.locator("#account-email").fill(QA_ACCOUNT);
      const accepted = observeResponse(page, reply => new URL(reply.url()).pathname === "/supabase/auth/v1/recover"
        && reply.request().method() === "POST");
      await page.getByRole("button", { name: "Send reset link", exact: true }).click();
      if ((await accepted).status() !== 200) throw new WriteQaError("RecoveryRequestNotAccepted_NoRetry");
      await page.goto(privateSinkLink(await native.sinkLink("recovery"), "recovery"), { waitUntil: "networkidle" });
      await page.getByLabel("New password", { exact: true }).fill(password);
      await page.getByLabel("Confirm new password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Update password", exact: true }).click();
      await page.getByRole("heading", { name: "Password updated", exact: true }).waitFor();
      await page.getByRole("link", { name: "Open dashboard", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).filter({ visible: true }).first().click();
    });
    await record("password-login", async () => {
      await pageGate(page, "/account");
      await page.locator("#account-email").fill(QA_ACCOUNT); await page.locator("#account-password").fill(password);
      const response = observeResponse(page, reply => new URL(reply.url()).pathname === "/supabase/auth/v1/token"
        && new URL(reply.url()).searchParams.get("grant_type") === "password" && reply.request().method() === "POST");
      await page.locator('form button[type="submit"]').click();
      if ((await response).status() !== 200) throw new WriteQaError("DisposablePasswordLoginFailed_NoRetry");
      await page.waitForURL(QA_ORIGIN + "/dashboard");
    });
    await record("magic-link", async () => {
      await page.getByRole("button", { name: "Sign out", exact: true }).filter({ visible: true }).first().click();
      const accepted = await native.requestMagicLink();
      if (accepted?.accepted !== true || accepted.accountVerified !== true || accepted.smtpSink !== true)
        throw new WriteQaError("PrivateMagicLinkRequestNotProven");
      await page.goto(privateSinkLink(await native.sinkLink("magiclink"), "magiclink"), { waitUntil: "networkidle" });
      await page.waitForURL(QA_ORIGIN + "/dashboard");
      // Explicit API-request + actual browser callback, never a fabricated UI button.
    });
    await record("job-search", async () => {
      await pageGate(page, "/jobs");
      const response = observeResponse(page, reply => new URL(reply.url()).pathname === "/api/jobs/search"
        && new URL(reply.url()).searchParams.get("q") === "zzir35p8writenomatch23");
      await page.getByRole("searchbox", { name: "Search contracts", exact: true }).fill("zzir35p8writenomatch23");
      const reply = await response;
      if (reply.status() !== 200 || !z.object({ jobs: z.array(z.unknown()).length(0), total: z.literal(0) }).safeParse(await reply.json()).success)
        throw new WriteQaError("ActualJobFilterRequired");
    });
    await record("job-page", () => pageGate(page, "/jobs/" + QA_JOB_IDS[0]));
    await record("save-job", async () => {
      const saved = observeResponse(page, reply => new URL(reply.url()).pathname === "/supabase/rest/v1/saved_jobs" && reply.request().method() === "POST");
      await page.getByRole("button", { name: "Save job", exact: true }).click();
      if (![200, 201, 204].includes((await saved).status())) throw new WriteQaError("ActualSaveWriteRequired");
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Saved", exact: true }).waitFor();
    });
    await record("mock-apply", async () => {
      for (let index = 0; index < QA_JOB_IDS.length; index++) {
        const jobId = QA_JOB_IDS[index]!;
        await pageGate(page, "/applications/new/" + jobId);
        // No readiness/answer bypass: existing blockers cause this real UI gate to fail.
        await page.locator("#application-final-approval").check();
        const response = observeResponse(page, reply => new URL(reply.url()).pathname === "/api/applications/submit" && reply.request().method() === "POST");
        await page.getByRole("button", { name: "Submit application", exact: true }).click();
        if ((await response).status() !== 202) throw new WriteQaError("MockSubmitNotAccepted_NoRetry");
        const terminal = checkPersistedMock(await native.terminal(jobId), index);
        await page.reload({ waitUntil: "networkidle" });
        if (terminal.status === "submitted") await page.getByRole("heading", { name: "Employer confirmation received", exact: true }).waitFor();
        else {
          await page.getByRole("heading", { name: "Not submitted", exact: true }).waitFor();
          await page.getByText(failureText, { exact: true }).waitFor();
        }
        journal.put(`mock-outcome-${index}-result.json`, { status: "PASS", jobIdSHA256: digest(jobId),
          deliveryStatus: terminal.status, failure: terminal.failure, visibleAfterReload: true,
          mockReceipts: terminal.mockReceipts, browserAttempts: 1, employerPayloads: 0, realEmailMessages: 0 });
      }
    });
    for (const [name, path] of [["account", "/profile"], ["dashboard", "/dashboard"]] as const)
      await record(name, () => pageGate(page, path));
    for (const [name, path] of [["sitemap", "/sitemap.xml"], ["robots", "/robots.txt"], ["llms", "/llms.txt"]] as const)
      await record(name, () => pageGate(page, path, false));
    const cookies = (await owned.context.cookies()).filter(cookie => cookie.name === "__Host-ir35-staging");
    if (cookies.length !== 1 || !cookies[0]!.secure || !cookies[0]!.httpOnly || cookies[0]!.sameSite !== "Strict" || cookies[0]!.path !== "/")
      throw new WriteQaError("ExistingSecureGateCookieRequired");
    if (owned.counts().transportErrors) throw new WriteQaError("PrivateBrowserTransportFailed");
    return { status: "PASS", cases, headed: true, actualServerResponses: true, namedAccountOnly: true,
      mockOnly: true, credentialsPersisted: false, realEmailMessages: 0, employerRequests: 0,
      transportErrors: 0, nativeExecutionProven: true, phaseComplete: false, signupNewUserProven: false,
      googleLoginProven: false, realSmtpProven: false, magicLinkMode: "PRIVATE_GOTRUE_REQUEST_AND_BROWSER_CALLBACK" };
  } catch {
    journal.put("browser-failure.json", { status: "FAIL", case: current, code: "BrowserWriteFailed_RawWithheld" });
    throw new WriteQaError("BrowserWriteFailed_RawWithheld");
  } finally {
    await closeWriteBrowser(owned, browser, binding.credentials);
  }
}

export function browserWritePlan() {
  return { status: "SOURCE_ONLY", nativeExecutionProven: false, phaseComplete: false, cutover: false,
    methods: "ACTUAL_UI_AND_PRIVATE_GOTRUE_CALLBACK", headed: true, credentialFiles: false,
    pendingNativeBindings: ["sealed-source-fixture-image-tunnel-attestation", "owned-smtp-link-bridge",
      "owned-private-otp-request", "independent-terminal-queue-ledger", "exclusive-evidence-and-unconditional-fixture-cleanup"],
    signupNewUserProven: false, googleLoginProven: false, realSmtpProven: false };
}

export function writeBrowserMain(argv: string[]) {
  if (!argv.length || argv.join(" ") === "--dry-run") return browserWritePlan();
  // Do not read stdin/private state or launch anything until the real owning
  // native controller is wired. A self-attested JSON document is insufficient.
  throw new WriteQaError("NativeQaLauncherNotWired_NoStdinOrBrowserRead");
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/oracle-staging-browser-write.ts")) {
  try { console.log(JSON.stringify(writeBrowserMain(process.argv.slice(2)))); }
  catch { console.log(JSON.stringify({ status: "STOP", code: "NativeQaLauncherNotWired", nativeExecutionProven: false, phaseComplete: false })); process.exitCode = 1; }
}
