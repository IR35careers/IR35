import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applicationWorkerCallbackUrl } from "@/lib/application-worker-auth";

describe("operator-owned application callback origin", () => {
  it("preserves the current production default", () => {
    expect(applicationWorkerCallbackUrl({}).toString())
      .toBe("https://www.ir35careers.com/api/applications/worker/callback");
  });
  it("uses the self-hosted app origin, not a hard-coded production destination", () => {
    expect(applicationWorkerCallbackUrl({ IR35CAREERS_APP_URL: "https://app.example.test" }).origin)
      .toBe("https://app.example.test");
  });
  it("permits only the exact protected staging origin when staging is explicit", () => {
    expect(applicationWorkerCallbackUrl({ IR35_STAGING: "true", IR35CAREERS_APP_URL: "https://staging.ir35careers.com" }).toString())
      .toBe("https://staging.ir35careers.com/api/applications/worker/callback");
  });
  it.each([
    { IR35_STAGING: "true" },
    { IR35_STAGING: "true", IR35CAREERS_APP_URL: "https://www.ir35careers.com" },
    { IR35_STAGING: "true", IR35CAREERS_APP_URL: "https://staging.ir35careers.com.evil.test" },
    { IR35_STAGING: "true", IR35CAREERS_APP_URL: "https://staging.ir35careers.com", VERCEL: "1" },
    { IR35_STAGING: "false", IR35CAREERS_APP_URL: "https://staging.ir35careers.com" },
    { IR35_STAGING: "TRUE", IR35CAREERS_APP_URL: "https://www.ir35careers.com" },
  ])("fails closed on staging/host mismatch %#", env => {
    expect(() => applicationWorkerCallbackUrl(env)).toThrow("Invalid application worker callback configuration.");
  });
  it.each([
    "http://app.example.test", "https://user:private-sentinel@app.example.test",
    "https://app.example.test/path", "https://app.example.test?private-sentinel=1",
    "https://app.example.test#private-sentinel", "https://app.example.test\nprivate-sentinel",
    "https://app.example.test\tprivate-sentinel", "https://app.example.test\rprivate-sentinel",
    "private-sentinel",
  ])("rejects unsafe or malformed operator config without exposing it %#", value => {
    let caught: unknown;
    try { applicationWorkerCallbackUrl({ IR35CAREERS_APP_URL: value }); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toBe("Error: Invalid application worker callback configuration.");
    expect(String(caught)).not.toContain("private-sentinel");
  });
  it("wires the real submit route before queued-state writes without using request Host", () => {
    const source = readFileSync("src/app/api/applications/submit/route.ts", "utf8");
    expect(source).toContain("? applicationWorkerCallbackUrl() : null");
    expect(source.indexOf("? applicationWorkerCallbackUrl() : null"))
      .toBeLessThan(source.indexOf('status: "queued", explicitRetry:'));
    expect(source).toContain("callback_url: callbackUrl.toString()");
    expect(source).not.toContain('new URL(\n        "/api/applications/worker/callback"');
  });
});
