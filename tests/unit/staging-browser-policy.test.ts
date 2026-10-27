import { describe, expect, it } from "vitest";
import { allowStagingRead, safeBrowserFailure, stagingBrowserBootstrap, stagingReadHeaders } from "../../services/application-worker/staging-browser-policy";
import { BrowserJournal } from "../../scripts/oracle-staging-browser-readonly";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, lstatSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";

const origin = "https://staging.ir35careers.com";

describe("protected Oracle read-only browser boundary", () => {
  it("preserves SDK Bearer/cookie headers and restricts Basic to approved edge reads", () => {
    const headers = { authorization: "Bearer PUBLIC-FIXTURE", cookie: "__Host-ir35-staging=PUBLIC-FIXTURE" };
    expect(stagingReadHeaders(origin + "/supabase/auth/v1/user", headers, "PUBLICFIXTURE")).toEqual(headers);
    expect(stagingReadHeaders(origin + "/jobs", headers, "PUBLICFIXTURE").authorization).toBe("Basic PUBLICFIXTURE");
    expect(() => stagingReadHeaders("https://www.ir35careers.com/jobs", headers, "PUBLICFIXTURE")).toThrow();
    expect(headers.authorization).toBe("Bearer PUBLIC-FIXTURE");
  });
  it("refuses evidence replay, overwrite, tampering and post-seal writes", () => {
    const directory = mkdtempSync(join(tmpdir(), "ir35-public-browser-journal-"));
    const journals: BrowserJournal[] = [];
    try {
      const path = join(directory, "one"); const journal = new BrowserJournal(path);
      journals.push(journal);
      journal.put("intent.json", { publicFixture: true });
      expect(() => journal.put("intent.json", { changed: true })).toThrow();
      expect(() => new BrowserJournal(path)).toThrow();
      expect(() => journal.put("../escape.json", {})).toThrow();
      expect(() => journal.put("invalid.json", undefined)).toThrow();
      const manifest = journal.seal({ status: "PASS" }); expect(manifest).toMatch(/^[a-f0-9]{64}$/);
      expect(() => journal.put("late.json", {})).toThrow();
      const second = new BrowserJournal(join(directory, "two")); second.put("intent.json", {});
      journals.push(second);
      writeFileSync(join(directory, "two/intent.json"), "tampered");
      expect(() => second.put("next.json", {})).toThrow();
      expect(readFileSync(join(path, "intent.json"), "utf8")).toContain("publicFixture");
    } finally {
      for (const journal of journals) journal.dispose();
      if (resolve(dirname(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("ir35-public-browser-journal-") || lstatSync(directory).isSymbolicLink()) throw new Error("TemporaryFixtureCleanupBoundary");
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("rejects pathname replacement and hashes only a retained owned descriptor", () => {
    const directory = mkdtempSync(join(tmpdir(), "ir35-public-browser-journal-"));
    const journal = new BrowserJournal(join(directory, "one"));
    try {
      journal.put("intent.json", { original: true });
      const original = resolve(directory, "one/intent.json"); const moved = resolve(directory, "moved.json");
      if (!original.startsWith(resolve(directory) + "/") && !original.startsWith(resolve(directory) + "\\")) throw new Error("PublicFixtureMoveBoundary");
      if (dirname(moved) !== resolve(directory) || !basename(directory).startsWith("ir35-public-browser-journal-")) throw new Error("PublicFixtureMoveBoundary");
      renameSync(original, moved); writeFileSync(original, "replacement");
      expect(() => journal.put("next.json", {})).toThrow("ArtifactIdentityChanged");
      const source = readFileSync(resolve("scripts/oracle-staging-browser-readonly.ts"), "utf8");
      expect(source).toContain("readSync(descriptor, buffer");
      expect(source).not.toContain("readFileSync(");
    } finally {
      journal.dispose();
      if (resolve(dirname(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("ir35-public-browser-journal-") || lstatSync(directory).isSymbolicLink()) throw new Error("TemporaryFixtureCleanupBoundary");
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("permits actual public HTML/assets/search/SDK reads only", () => {
    for (const path of ["/", "/jobs", "/jobs?q=zzir35p8readonlynomatch27", "/jobs/11111111-1111-4111-8111-111111111111",
      "/tools/ir35-status", "/tools/take-home", "/account", "/dashboard", "/_next/static/chunks/public.js",
      "/api/jobs/search?q=DevOps&with_facets=1", "/api/health", "/supabase/auth/v1/user", "/robots.txt", "/sitemap.xml", "/llms.txt"]) {
      expect(allowStagingRead({ method: "GET", url: origin + path }), path).toBe(true);
    }
  });
  it("refuses all writes, other origins, credentials, redirects and side-effecting GETs", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "get"]) expect(allowStagingRead({ method, url: origin + "/api/jobs/search" })).toBe(false);
    for (const url of ["https://www.ir35careers.com/jobs", "https://api-staging.ir35careers.com/auth/v1/token",
      "https://staging.ir35careers.com.attacker.invalid/jobs", "http://staging.ir35careers.com/jobs", "https://staging.ir35careers.com:444/jobs",
      "https://name:private@staging.ir35careers.com/jobs", origin + "/api/pipeline/fetch", origin + "/api/automation/run",
      origin + "/auth/callback?code=private", origin + "/supabase/auth/v1/verify?token=private", origin + "/jobs?redirect_to=https://invalid.test",
      origin + "/jobs#private", origin + "/%61pi/health", origin + "/_next/image?url=https%3A%2F%2Foutside.invalid%2Fphoto.png"]) {
      expect(allowStagingRead({ method: "GET", url }), url).toBe(false);
    }
    expect(allowStagingRead({ method: "GET", url: origin + "/_next/image?url=%2Fbrand%2Flogo.png&w=64&q=75" })).toBe(true);
  });
  it("validates private bootstrap without logging an offending value", () => {
    const fixture = { status: "PASS", origin, username: "ir35", password: "a".repeat(48), mockOnly: true, realAcceptance: false, readOnly: true, smtpSink: true };
    expect(stagingBrowserBootstrap.safeParse(fixture).success).toBe(true);
    for (const change of [{ realAcceptance: true }, { readOnly: false }, { smtpSink: false }, { origin: "https://www.ir35careers.com" }, { extra: "private" }]) {
      expect(stagingBrowserBootstrap.safeParse({ ...fixture, ...change }).success).toBe(false);
    }
    expect(JSON.stringify(safeBrowserFailure(new Error("private-password Bearer private-token")))).not.toContain("private");
    const named = new Error("private-password"); named.name = "private-token";
    expect(JSON.stringify(safeBrowserFailure(named))).not.toContain("private");
  });
});
