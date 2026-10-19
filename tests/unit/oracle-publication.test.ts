import { describe, expect, it } from "vitest";
import { verifyPublicationGates } from "../../infra/oracle/publication";
import { dockerEnvironment } from "../../infra/oracle/host-command";

const sha = "a".repeat(40);
const fixtures = () => {
  const values = new Map<string, unknown>([["/repos/IR35careers/IR35", { full_name: "IR35careers/IR35", private: false, default_branch: "main" }],
    ["/repos/IR35careers/IR35/commits/main", { sha }]]);
  for (const workflow of ["quality.yml", "oracle-arm64.yml", "codeql.yml"]) values.set(`/repos/IR35careers/IR35/actions/workflows/${workflow}/runs?head_sha=${sha}&event=push&per_page=20`, {
    workflow_runs: [{ head_sha: sha, head_branch: "main", event: "push", path: `.github/workflows/${workflow}`,
      status: "completed", conclusion: "success", head_repository: { full_name: "IR35careers/IR35" } }],
  });
  return values;
};
describe("free exact-main-commit image publication gates", () => {
  it("requires a public repository and all three actual successful push workflows", async () => {
    const data = fixtures(); const calls: string[] = [];
    expect(await verifyPublicationGates(sha, async path => { calls.push(path); return data.get(path); })).toBe(sha);
    expect(calls).toHaveLength(5);
  });
  it.each(["quality.yml", "oracle-arm64.yml", "codeql.yml"])("does not infer %s success from the Release quality trigger", async workflow => {
    const data = fixtures(); data.set(`/repos/IR35careers/IR35/actions/workflows/${workflow}/runs?head_sha=${sha}&event=push&per_page=20`, { workflow_runs: [] });
    await expect(verifyPublicationGates(sha, async path => data.get(path))).rejects.toThrow("requires successful");
  });
  it.each([
    { head_sha: "b".repeat(40) }, { head_branch: "feature" }, { event: "pull_request" }, { path: ".github/workflows/lookalike.yml" },
    { status: "in_progress" }, { conclusion: "failure" }, { conclusion: "skipped" }, { head_repository: { full_name: "attacker/IR35" } },
  ])("rejects unrelated, running, failed, skipped or fork runs: %j", async patch => {
    const data = fixtures(); const path = `/repos/IR35careers/IR35/actions/workflows/quality.yml/runs?head_sha=${sha}&event=push&per_page=20`;
    const fixture = data.get(path) as { workflow_runs: Record<string, unknown>[] };
    Object.assign(fixture.workflow_runs[0], patch);
    await expect(verifyPublicationGates(sha, async key => data.get(key))).rejects.toThrow();
  });
  it("fails closed on main movement, paid/private repository, malformed responses and bad revisions", async () => {
    const data = fixtures(); data.set("/repos/IR35careers/IR35/commits/main", { sha: "b".repeat(40) });
    await expect(verifyPublicationGates(sha, async path => data.get(path))).rejects.toThrow("Main moved");
    data.set("/repos/IR35careers/IR35", { full_name: "IR35careers/IR35", private: true, default_branch: "main" });
    await expect(verifyPublicationGates(sha, async path => data.get(path))).rejects.toThrow();
    await expect(verifyPublicationGates(sha, async () => null)).rejects.toThrow();
    let called = false; await expect(verifyPublicationGates("not-sha", async () => { called = true; })).rejects.toThrow(); expect(called).toBe(false);
  });
  it("does not inherit app secrets, arbitrary Docker endpoints, or Compose/cutover overrides into commands", () => {
    const result = dockerEnvironment({ PATH: "/controlled", HOME: "/controlled-home", DOCKER_CONFIG: "/controlled-config",
      SUPABASE_SECRET_KEY: "do-not-pass", APPLY_RUNNER: "oracle", APPLICATION_WORKER_ACCEPT_JOBS: "true", COMPOSE_FILE: "attacker",
      DOCKER_HOST: "tcp://attacker:2375", GHCR_TOKEN: "do-not-pass", APPLICATION_WORKER_SECRET: "do-not-pass" });
    expect(result).toEqual({ PATH: "/controlled", HOME: "/controlled-home", DOCKER_CONFIG: "/controlled-config", LANG: "C.UTF-8", NODE_ENV: "production" });
    expect(JSON.stringify(result)).not.toContain("do-not-pass");
  });
});
