import { describe, expect, it, vi } from "vitest";
import { WorkerRegistry } from "../../infra/oracle/registry";

const base = "a".repeat(40), head = "b".repeat(40);
const ahead = (sha: string) => ({ status: "ahead", ahead_by: 2, behind_by: 0, base_commit: { sha }, merge_base_commit: { sha }, commits: [] });
function fixture(options: { repo?: object; forward?: object; main?: object; status?: number; huge?: boolean; network?: boolean } = {}) {
  const http = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.redirect).toBe("error"); expect(new URL(url).hostname).toBe("api.github.com");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    if (options.network) throw new Error("controlled-private-network-diagnostic");
    if (options.huge) return new Response("x".repeat(131_073));
    if (url.endsWith("/IR35careers/IR35")) return new Response(JSON.stringify(options.repo ?? { full_name: "IR35careers/IR35", private: false, default_branch: "main" }));
    return new Response(JSON.stringify(url.includes("...main?") ? options.main ?? ahead(head) : options.forward ?? ahead(base)), { status: options.status ?? 200 });
  });
  return { http, registry: new WorkerRegistry({ username: "ir35-owner", credential: "controlled_read_only_fixture_12345" }, http) };
}
describe("public forward-release and main-membership proof", () => {
  it.each(["ahead", "identical"])("checks both immutable ancestry directions without diff downloads or credential scope changes: %s", async status => {
    const f = fixture({ main: { ...ahead(head), status, ahead_by: status === "identical" ? 0 : 2 } });
    await expect(f.registry.requireSuccessor(base, head)).resolves.toBeUndefined();
    expect(f.http.mock.calls.map(call => call[0])).toEqual(["https://api.github.com/repos/IR35careers/IR35",
      `https://api.github.com/repos/IR35careers/IR35/compare/${base}...${head}?per_page=1&page=2`,
      `https://api.github.com/repos/IR35careers/IR35/compare/${head}...main?per_page=1&page=2`]);
  });
  it.each([
    { status: "behind" }, { status: "diverged" }, { status: "identical", ahead_by: 0 }, { ahead_by: 0 }, { behind_by: 1 },
    { base_commit: { sha: head } }, { merge_base_commit: { sha: head } }, { ahead_by: -1 }, { status: "private-untrusted-input" },
  ])("rejects downgrade/divergence or mismatched forward metadata: %j", async change => {
    const f = fixture({ forward: { ...ahead(base), ...change } });
    await expect(f.registry.requireSuccessor(base, head)).rejects.toThrow("verified forward update"); expect(f.http).toHaveBeenCalledTimes(2);
  });
  it.each([
    { status: "behind", behind_by: 1 }, { status: "diverged" }, { merge_base_commit: { sha: base } }, { base_commit: { sha: base } },
    { status: "identical", ahead_by: 1 }, { status: "ahead", ahead_by: 0 },
  ])("rejects a signed candidate that is not proven on main: %j", async change => {
    await expect(fixture({ main: { ...ahead(head), ...change } }).registry.requireSuccessor(base, head)).rejects.toThrow("verified forward update");
  });
  it.each([{ private: true }, { default_branch: "other" }, { full_name: "other/IR35" }])("refuses private/renamed/wrong repository policy: %j", async change => {
    const f = fixture({ repo: { full_name: "IR35careers/IR35", private: false, default_branch: "main", ...change } });
    await expect(f.registry.requireSuccessor(base, head)).rejects.toThrow(); expect(f.http).toHaveBeenCalledTimes(1);
  });
  it.each([{ status: 403 }, { status: 429 }, { status: 500 }, { huge: true }, { network: true }])("unavailable proof is not permission to skip ancestry: %j", async options => {
    const result = fixture(options).registry.requireSuccessor(base, head);
    await expect(result).rejects.toThrow("no selection changed"); await expect(result).rejects.not.toThrow("private-network");
  });
  it("rejects equal/malformed/shell-like revisions before any request", async () => {
    for (const value of [base, "main", head + "\n--option", null]) {
      const f = fixture(); await expect(f.registry.requireSuccessor(base, value)).rejects.toThrow(); expect(f.http).not.toHaveBeenCalled();
    }
  });
});
