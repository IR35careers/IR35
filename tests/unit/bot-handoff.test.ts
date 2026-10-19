import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";
import { REPOSITORY, TEST_ACCOUNT, botBranch, eligiblePreview, formField, handoffProblem, issueLabels, linkedIssue, sensitiveFiles, staleBotIssue } from "../../scripts/bots/policy";
import { closeStale, reportChecks, selectPreview, syncIssue, syncPr, type Api } from "../../scripts/bots/github-loop";
import { BOT_PREVIEW_PROJECT_ID, previewBuildEnvironment, projectConfig } from "../../scripts/bots/vercel-config";

const sha = "a".repeat(40), now = Date.parse("2026-10-19T10:00:00Z");
const body = "### Reporter bot\n\nQA Bot\n\n### Steps to reproduce\n\nOpen the mobile jobs filter and select Outside IR35.\n\n### Expected\n\nResults fit the viewport.\n\n### Actual\n\nThe cards overflow the mobile viewport.\n\n### Screenshot/log\n\nRedacted screenshot shows 30 pixels of overflow.\n\n### Account used\n\n" + TEST_ACCOUNT + "\n\n### Priority\n\nP1";
const issue = () => ({ number: 42, title: "Mobile job cards overflow", state: "open", body, labels: ["bug", "qa-bot", "codex-ready", "P1"].map(name => ({ name })), updated_at: "2026-09-01T10:00:00Z" });
const pr = () => ({ number: 88, state: "open", draft: true, body: "Fixes #42\n\n## Test plan\nOpen the preview jobs page.", labels: [],
  head: { sha, ref: "codex/issue-42-mobile-cards", repo: { full_name: REPOSITORY } },
  base: { ref: "main", repo: { full_name: REPOSITORY } } });
const deployment = () => ({ id: 7_166_405_177, sha, environment: "Preview", production_environment: false, creator: { login: "vercel[bot]" } });
const status = () => ({ id: 9_000_000_001, state: "success", creator: { login: "vercel[bot]" }, environment_url: "https://ir35-bot-preview-abc123-team.vercel.app/" });
function apiFixture(overrides: Record<string, unknown> = {}) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  const api = vi.fn<Api>(async (path, method = "GET", data) => {
    const key = path.replace(/([?&])per_page=\d+/g, "$1").replace(/&page=\d+/g, "").replace(/\?&/, "?").replace(/[?&]$/, "");
    if (method !== "GET") { writes.push({ path, method, body: data }); return {}; }
    if (Object.hasOwn(overrides, path)) return structuredClone(overrides[path]);
    if (Object.hasOwn(overrides, key)) return structuredClone(overrides[key]);
    if (/\/pulls\/88\/files/.test(path)) return [{ filename: "src/components/JobCard.tsx", patch: "+ improved spacing" }];
    if (/\/pulls\/88$/.test(path)) return pr();
    if (/\/issues\/42$/.test(path)) return issue();
    if (/\/comments/.test(path)) return [];
    if (/\/pulls\?/.test(path)) return [pr()];
    if (/\/deployments\/7166405177\/statuses/.test(path)) return [status()];
    if (/\/deployments\/7166405177$/.test(path)) return deployment();
    throw new Error("Unexpected fixture route: " + path);
  });
  return { api, writes };
}
describe("bot issue handoff and preview policy", () => {
  it("reads actual GitHub form sections, maps source/priority, and requires one evidenced P0/P1", () => {
    expect(formField(body, "Steps to reproduce")).toContain("select Outside IR35");
    expect(formField(body, "Priority")).toBe("P1");
    expect(issueLabels(issue())).toEqual(["qa-bot", "P1"]);
    expect(handoffProblem(issue())).toBeNull();
    for (const changed of [{ body: "" }, { labels: [{ name: "codex-ready" }, { name: "P2" }] },
      { labels: [...issue().labels, { name: "needs-human" }] }, { body: body.replace(TEST_ACCOUNT, "customer@example.test") }])
      expect(handoffProblem({ ...issue(), ...changed })).not.toBeNull();
  });
  it("parses one real same-repo closing reference, never URLs, comments, code, duplicates or shell-like text", () => {
    expect(linkedIssue(pr().body)).toBe(42); expect(botBranch(pr().head.ref, 42)).toBe(true);
    for (const text of ["Fixes https://github.com/other/repo/issues/42", "Fixes #0", "Fixes #42; run code", "Fixes #42\nFixes #43", "<!-- Fixes #42 -->", "\x60\x60\x60\nFixes #42\n\x60\x60\x60"])
      expect(linkedIssue(text)).toBeNull();
  });
  it("escalates sensitive text/files instead of handing off auth, billing, schemas or deployment controls", () => {
    expect(handoffProblem({ ...issue(), title: "Billing failure" })).toContain("owner");
    for (const filename of ["supabase/migrations/026.sql", "src/lib/auth-context.tsx", ".env.local", ".github/workflows/pr-checks.yml", "infra/oracle/deploy.env", "vercel.ts"])
      expect(sensitiveFiles([{ filename }])).toBe(true);
    expect(sensitiveFiles([{ filename: "src/components/JobCard.tsx", patch: "+ APPLICATION_WORKER_ACCEPT_JOBS=true" }])).toBe(true);
    expect(sensitiveFiles([{ filename: "src/components/JobCard.tsx", patch: "+ rounded-xl" }])).toBe(false);
  });
  it("accepts only Vercel's successful isolated preview for the exact current same-repo draft head", () => {
    const input = { enabled: true, prefix: "ir35-bot-preview", deployment: deployment(), status: status(), pr: pr() };
    expect(eligiblePreview(input)).toEqual({ number: 88, sha, issue: 42, url: "https://ir35-bot-preview-abc123-team.vercel.app" });
    for (const changed of [{ enabled: false }, { deployment: { ...deployment(), production_environment: true } },
      { status: { ...status(), creator: { login: "attacker" } } }, { pr: { ...pr(), head: { ...pr().head, sha: "b".repeat(40) } } },
      { pr: { ...pr(), labels: [{ name: "needs-human" }] } },
      { pr: { ...pr(), head: { ...pr().head, repo: { full_name: "other/fork" } } } }])
      expect(eligiblePreview({ ...input, ...changed })).toBeNull();
    for (const url of ["https://www.ir35careers.com", "https://ir-35-existing.vercel.app/", "https://ir35-bot-preview-a.vercel.app.attacker.test/", "http://ir35-bot-preview-a.vercel.app/", "https://user@ir35-bot-preview-a.vercel.app/", "https://ir35-bot-preview-a.vercel.app/?token=private"])
      expect(eligiblePreview({ ...input, status: { ...status(), environment_url: url } })).toBeNull();
  });
  it("stale closure excludes humans, PRs, recent activity and any active/escalated issue", () => {
    const stale = { ...issue(), labels: [{ name: "triage" }, { name: "qa-bot" }] };
    expect(staleBotIssue(stale, now)).toBe(true);
    for (const changed of [{ pull_request: {} }, { updated_at: "2026-10-18T10:00:00Z" },
      { labels: [{ name: "triage" }] }, ...["codex-ready", "codex-working", "needs-human"].map(name => ({ labels: [...stale.labels, { name }] }))])
      expect(staleBotIssue({ ...stale, ...changed }, now)).toBe(false);
  });
});
describe("trusted metadata workflows, not PR code execution", () => {
  it("opens working state only for a ready, small non-sensitive draft and clears old preview labels on new commits", async () => {
    const f = apiFixture(); await syncPr(f.api, { action: "opened", pull_request: { number: 88 } });
    expect(f.writes).toEqual([{ path: "/repos/" + REPOSITORY + "/issues/42/labels", method: "POST", body: { labels: ["codex-working"] } }]);
    const changed = apiFixture({ ["/repos/" + REPOSITORY + "/pulls/88"]: { ...pr(), labels: [{ name: "preview-pass" }] } });
    await syncPr(changed.api, { action: "synchronize", pull_request: { number: 88 } });
    expect(changed.writes.some(write => write.method === "DELETE" && write.path.endsWith("/preview-pass"))).toBe(true);
  });
  it("missing evidence or sensitive files asks the owner, never auto-comments a Codex invocation", async () => {
    const f = apiFixture({ ["/repos/" + REPOSITORY + "/issues/42"]: { ...issue(), body: "" } });
    await syncIssue(f.api, { issue: { number: 42 } });
    expect(JSON.stringify(f.writes)).toContain("needs-human"); expect(JSON.stringify(f.writes)).not.toContain("@codex");
    const protectedPr = apiFixture({ ["/repos/" + REPOSITORY + "/pulls/88/files"]: [{ filename: "src/lib/auth-context.tsx" }] });
    await syncPr(protectedPr.api, { action: "opened", pull_request: { number: 88 } });
    expect(JSON.stringify(protectedPr.writes)).toContain("needs-human"); expect(JSON.stringify(protectedPr.writes)).not.toContain("codex-working");
  });
  it("a human-selected P0 label is not contradicted by an older P1 form value", async () => {
    const value = { ...issue(), labels: issue().labels.map(label => label.name === "P1" ? { name: "P0" } : label) };
    const f = apiFixture({ ["/repos/" + REPOSITORY + "/issues/42"]: value });
    await syncIssue(f.api, { issue: { number: 42 } });
    expect(f.writes).toEqual([]);
  });
  it("revalidates the deployment/status/issue/files via GitHub before selecting the preview", async () => {
    const f = apiFixture();
    expect(await selectPreview(f.api, { deployment: { id: deployment().id }, deployment_status: { id: status().id } }, { enabled: true, prefix: "ir35-bot-preview" })).toMatchObject({ number: 88, sha });
    expect(f.writes).toEqual([]);
    expect(await selectPreview(f.api, { deployment: { id: deployment().id }, deployment_status: { id: 1 } }, { enabled: true, prefix: "ir35-bot-preview" })).toBeNull();
  });
  it("skipped preview jobs and superseded runs cannot produce PASS labels or comments", async () => {
    const runId = 39_205_635_196, root = "/repos/" + REPOSITORY;
    const run = { id: runId, run_attempt: 1, head_sha: sha, event: "deployment_status", status: "completed", path: ".github/workflows/pr-checks.yml", head_repository: { full_name: REPOSITORY }, html_url: "https://github.com/" + REPOSITORY + "/actions/runs/" + runId };
    for (const conclusion of ["skipped", "success", "failure"]) {
      const f = apiFixture({ [root + "/actions/runs/" + runId]: run,
        [root + "/actions/workflows/pr-checks.yml/runs?head_sha=" + sha + "&event=deployment_status&per_page=1"]: { workflow_runs: [{ id: runId }] },
        [root + "/actions/runs/" + runId + "/jobs?filter=latest&per_page=100"]: { jobs: [{ name: "preview-smoke", conclusion }] } });
      await reportChecks(f.api, { workflow_run: { id: runId, run_attempt: 1 } });
      const changes = JSON.stringify(f.writes);
      if (conclusion === "skipped") expect(f.writes).toEqual([]);
      else expect(changes).toContain(conclusion === "success" ? "preview-pass" : "preview-fail");
      if (conclusion === "failure") expect(changes).toContain("needs-human");
      expect(changes).not.toContain("@codex"); expect(changes).not.toContain('"merge"');
    }
  });
  it("closes only old triage bot issues, not issues with open linked PRs", async () => {
    const stale = { ...issue(), labels: [{ name: "triage" }, { name: "qa-bot" }] }, root = "/repos/" + REPOSITORY;
    const f = apiFixture({ [root + "/issues?state=open&labels=triage&sort=updated&direction=asc"]: [stale], [root + "/issues/42"]: stale, [root + "/pulls?state=open&base=main"]: [] });
    expect(await closeStale(f.api, now)).toBe(1);
    expect(f.writes.at(-1)).toMatchObject({ method: "PATCH", body: { state: "closed" } });
    const linked = apiFixture({ [root + "/issues?state=open&labels=triage&sort=updated&direction=asc"]: [stale] });
    expect(await closeStale(linked.api, now)).toBe(0); expect(linked.writes).toEqual([]);
  });
});
describe("separate mock project and unchanged production gates", () => {
  it("unknown/live projects keep the base holds, while the exact new project has no crons or queue trigger", () => {
    for (const project of [undefined, "prj_3L46KZkdPSiqrvzRO2HUimvmqDth", "attacker"]) {
      const config = projectConfig(project);
      expect(config.git.deploymentEnabled.main).toBe(false); expect(config.git.deploymentEnabled["codex/issue-*"]).toBe(false);
      expect(Object.values(config.git.deploymentEnabled)).not.toContain(true);
    }
    const isolated = projectConfig(BOT_PREVIEW_PROJECT_ID);
    expect(isolated.crons).toEqual([]); expect(isolated.functions).toEqual({});
    expect(isolated.git.deploymentEnabled["codex/issue-*"]).toBe(true);
    expect(isolated.git.deploymentEnabled.main).toBe(false);
  });
  it("refuses production/foreign projects or copied app credentials; never passes platform tokens to the child build", () => {
    const env = { VERCEL_PROJECT_ID: BOT_PREVIEW_PROJECT_ID, VERCEL_ENV: "preview", IR35CAREERS_E2E_DEMO_DATA: "1", IR35CAREERS_BOT_PREVIEW: "1", VERCEL_OIDC_TOKEN: "controlled-private-platform-token", PATH: "/test" };
    expect(previewBuildEnvironment(env).VERCEL_OIDC_TOKEN).toBeUndefined();
    expect(previewBuildEnvironment(env).NEXT_PUBLIC_SUPABASE_URL).toBe("");
    for (const changed of [{ VERCEL_ENV: "production" }, { VERCEL_PROJECT_ID: "other" }, { SUPABASE_SECRET_KEY: "controlled-private" }, { NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co" }])
      expect(() => previewBuildEnvironment({ ...env, ...changed })).toThrow();
  });
  it("the mock flag disables writes, auth/worker/mail hooks and external importers without changing normal production", async () => {
    vi.stubEnv("IR35CAREERS_BOT_PREVIEW", "1");
    try {
      for (const [method, path] of [["POST", "/api/applications/submit"], ["GET", "/api/jobs/preview"], ["POST", "/api/integrations/email/inbound"]]) {
        const response = proxy(new NextRequest("https://ir35-bot-preview-a.vercel.app" + path, { method }));
        expect(response.status).toBe(503); expect(response.headers.get("x-ir35-bot-preview")).toBe("mock-only-v1");
      }
      const read = proxy(new NextRequest("https://ir35-bot-preview-a.vercel.app/api/jobs/search"));
      expect(read.status).toBe(200); expect(read.headers.get("content-security-policy")).toContain("connect-src 'self';");
    } finally { vi.unstubAllEnvs(); }
  });
  it("uses pinned free hosted actions, not an API-key Codex action, SSH deployer or automatic merge", () => {
    for (const file of ["pr-checks.yml", "label-sync.yml", "stale-bot-issues.yml"]) {
      const source = readFileSync(".github/workflows/" + file, "utf8");
      expect(source).not.toMatch(/openai\/codex-action|OPENAI_API_KEY|self-hosted|pull_request\.head\.sha|--admin|--auto/);
      expect(source).toContain("persist-credentials: false"); expect(source).toContain("timeout-minutes:");
    }
    expect(readFileSync(".github/CODEOWNERS", "utf8")).toContain("* @IR35careers");
  });
});
