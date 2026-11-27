import { describe, expect, it, vi } from "vitest";
import { chromium } from "playwright-core";
import { browserWritePlan, checkPersistedMock, closeWriteBrowser, parseWriteBinding, privateSinkLink, QA_ACCOUNT, QA_JOB_IDS,
  readWriteBinding, runOwnedBrowserJourneys, WriteQaError, writeBrowserMain, type OwnedQaNativeBindings } from "../../scripts/oracle-staging-browser-write";

const sourceSHA = "a".repeat(40);
function binding() {
  return { version: 1, scope: "OWNED_DISPOSABLE_STAGING_ONLY", slot: "writable-qa-20261124t120000z-0123abcd",
    sourceSHA, fixture: "webqa01", origin: "https://staging.ir35careers.com", account: QA_ACCOUNT,
    database: "ir35_p4_20261021t170139z_8be0fc2e_p8_webqa01", tunnel: { host: "127.0.0.1", port: 19443, fixture: "webqa01" },
    images: { web: { sourceSHA, digest: "sha256:" + "b".repeat(64) }, worker: { sourceSHA, digest: "sha256:" + "c".repeat(64) } },
    baselineManifestSHA256: "d".repeat(64), fixtureManifestSHA256: "e".repeat(64), originalRuntimeReadOnly: true,
    cloneHbaDenials: 8, applyRunner: "mock", smtpSink: true, acceptJobs: false, liveProvidersConfigured: false,
    publicPorts: 0, credentials: { username: "ir35", password: "f".repeat(48) } };
}
function link(kind: "recovery" | "magiclink") {
  return "https://api-staging.ir35careers.com/auth/v1/verify?token=" + "a".repeat(56) + "&type=" + kind
    + "&redirect_to=" + encodeURIComponent("https://staging.ir35careers.com/auth/callback?next=" + encodeURIComponent(kind === "recovery" ? "/account/reset" : "/dashboard"));
}

describe("source-only actual-browser write journey boundary (no browser/network/private state)", () => {
  it("defaults to an honest dry-run and refuses any native CLI before stdin", () => {
    for (const args of [[], ["--dry-run"]]) expect(writeBrowserMain(args)).toEqual(browserWritePlan());
    expect(browserWritePlan()).toMatchObject({ status: "SOURCE_ONLY", nativeExecutionProven: false, phaseComplete: false, cutover: false });
    for (const args of [["--execute"], ["--owned-private-fixture", "--stdin"]])
      expect(() => writeBrowserMain(args)).toThrow("NativeQaLauncherNotWired_NoStdinOrBrowserRead");
  });
  it("accepts only the one exact source/image/mock/private/named-account binding", () => {
    expect(parseWriteBinding(binding()).sourceSHA).toBe(sourceSHA);
    const changes = [{ account: "customer@example.invalid" }, { origin: "https://www.ir35careers.com" },
      { scope: "PRODUCTION" }, { acceptJobs: true }, { applyRunner: "oracle" }, { smtpSink: false },
      { liveProvidersConfigured: true }, { publicPorts: 1 }, { cloneHbaDenials: 0 },
      { slot: "browser-readonly-01" }, { tunnel: { host: "0.0.0.0", port: 19443, fixture: "webqa01" } }];
    for (const change of changes) expect(() => parseWriteBinding({ ...binding(), ...change })).toThrow("OwnedPrivateMockRuntimeBindingRequired");
    const badSource = binding(); badSource.images.worker.sourceSHA = "c".repeat(40);
    expect(() => parseWriteBinding(badSource)).toThrow("OwnedPrivateMockRuntimeBindingRequired");
  });
  it("requires concrete native adapters before browser or any attestation I/O", async () => {
    const launch = vi.spyOn(chromium, "launch").mockRejectedValue(new Error("MUST_NOT_RUN"));
    try {
      const journal = { put: vi.fn() };
      await expect(runOwnedBrowserJourneys(binding(), undefined, journal)).rejects.toThrow("ConcretePrivateQaBackendBindingsMissing");
      expect(launch).not.toHaveBeenCalled(); expect(journal.put).not.toHaveBeenCalled();
    } finally { launch.mockRestore(); }
  });
  it("redacts rejected native attestation before launching a browser", async () => {
    const launch = vi.spyOn(chromium, "launch").mockRejectedValue(new Error("MUST_NOT_RUN"));
    const native: OwnedQaNativeBindings = {
      attest: async () => { throw new Error("password=PRIVATE_SENTINEL"); },
      sinkLink: async () => { throw new Error("MUST_NOT_RUN"); },
      requestMagicLink: async () => ({ accepted: true, accountVerified: true, smtpSink: true }),
      terminal: async () => { throw new Error("MUST_NOT_RUN"); },
    };
    try {
      await expect(runOwnedBrowserJourneys(binding(), native, { put: vi.fn() })).rejects.toThrow("ActualPrivateFixtureAttestationRequired");
      expect(launch).not.toHaveBeenCalled();
    } finally { launch.mockRestore(); }
  });
  it("keeps the explicit stdin boundary bounded with only fixed errors", async () => {
    async function* stream(bytes: Buffer) { yield bytes; }
    const source = Buffer.from(JSON.stringify(binding()));
    expect((await readWriteBinding(stream(source))).fixture).toBe("webqa01");
    // Caller-owned input is not mutated; only the reader's owned copies are erased.
    expect(source.length).toBeGreaterThan(0);
    for (const bad of [Buffer.from("password=PRIVATE_SENTINEL"), Buffer.alloc(32_769)])
      await expect(readWriteBinding(stream(bad))).rejects.toThrow("InvalidPrivateRuntimeStdin_RawWithheld");
    expect(() => parseWriteBinding({ password: "PRIVATE_SENTINEL" })).toThrow("OwnedPrivateMockRuntimeBindingRequired");
  });
  it("rewrites only exact private GoTrue sink URLs, with no real mailbox or provider destination", () => {
    for (const kind of ["recovery", "magiclink"] as const) {
      const target = new URL(privateSinkLink(link(kind), kind));
      expect(target.origin).toBe("https://staging.ir35careers.com");
      expect(target.pathname).toBe("/supabase/auth/v1/verify");
      expect(target.searchParams.get("type")).toBe(kind);
    }
    for (const bad of [link("recovery").replace("api-staging", "api"), link("recovery") + "&token=another",
      link("recovery") + "#PRIVATE_SENTINEL", link("recovery").replace("https://", "http://"),
      link("magiclink"), "https://accounts.google.com/?token=PRIVATE_SENTINEL", "x\nPRIVATE_SENTINEL"])
      expect(() => privateSinkLink(bad, "recovery")).toThrow("PrivateSinkLinkRejected");
    const foreignRedirect = new URL(link("recovery"));
    foreignRedirect.searchParams.set("redirect_to", "https://staging.ir35careers.com/auth/callback?next=" + encodeURIComponent("https://evil.invalid"));
    expect(() => privateSinkLink(foreignRedirect.href, "recovery")).toThrow("PrivateSinkLinkRejected");
  });
  it("requires exact persisted terminal states, receipt count and no real effects", () => {
    const good = { jobId: QA_JOB_IDS[0], applicationId: "00000000-0000-4000-8000-000000000001", status: "submitted", failure: null,
      mockReceipts: 1, browserAttempts: 1, realEmailMessages: 0, employerPayloads: 0, queueAcknowledged: true };
    expect(checkPersistedMock(good, 0).status).toBe("submitted");
    for (const change of [{ status: "ready" }, { status: "queued" }, { failure: "not-known" }, { mockReceipts: 0 },
      { browserAttempts: 2 }, { employerPayloads: 1 }, { realEmailMessages: 1 }, { queueAcknowledged: false }])
      expect(() => checkPersistedMock({ ...good, ...change }, 0)).toThrow("ExactPersistedMockOutcomeRequired_NoReadyFallback");
    const failed = { ...good, jobId: QA_JOB_IDS[1], status: "failed", failure: "mock_ats_http_500", mockReceipts: 0 };
    expect(checkPersistedMock(failed, 1).status).toBe("failed");
    expect(() => checkPersistedMock({ ...failed, failure: "" }, 1)).toThrow("ExactPersistedMockOutcomeRequired");
  });
  it("never incorporates an error message, password, token or session in the error", () => {
    expect(new WriteQaError("password=PRIVATE_SENTINEL").message).toBe("WriteQaErrorWithheld");
    expect(JSON.stringify(browserWritePlan())).not.toContain("PRIVATE_SENTINEL");
  });
  it("retains RAM-only gate credentials until context close, erases them and sanitises cleanup failures", async () => {
    const credential = { username: "ir35" as const, password: "f".repeat(48) };
    const calls: string[] = [];
    const context = { close: async () => { expect(credential.password).toHaveLength(48); calls.push("context"); } };
    const browser = { close: async () => { calls.push("browser"); } };
    await closeWriteBrowser(context, browser, credential);
    expect(credential.password).toBe(""); expect(calls).toEqual(["context", "browser"]);
    credential.password = "f".repeat(48);
    const bad = { close: async () => { throw new Error("password=PRIVATE_SENTINEL"); } };
    await expect(closeWriteBrowser(bad, browser, credential)).rejects.toThrow("OwnedBrowserCleanupFailed_RawWithheld");
    expect(credential.password).toBe(""); expect(calls).toEqual(["context", "browser", "browser"]);
  });
});
