import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostCommand } from "../../infra/oracle/host-command";

const child = vi.hoisted(() => ({ exec: vi.fn(), input: vi.fn(), on: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: child.exec }));
beforeEach(() => { vi.clearAllMocks(); });
describe("private stdin and redacted bounded host subprocesses", () => {
  it("passes credentials only on stdin with explicit environment and bounded output/deadline", async () => {
    child.exec.mockImplementation((_file, _args, _options, callback) => {
      queueMicrotask(() => callback(null, "controlled-public-result")); return { stdin: { on: child.on, end: child.input } };
    });
    const marker = "controlled-private-input";
    const result = await hostCommand("docker", ["login", "ghcr.io", "--password-stdin"], { env: { NODE_ENV: "production", PATH: "/fixed" }, input: marker, timeoutMs: 12_000 });
    expect(result).toBe("controlled-public-result"); expect(child.input).toHaveBeenCalledWith(marker);
    const [file, args, options] = child.exec.mock.calls[0];
    expect(file).toBe("docker"); expect(JSON.stringify([file, args, options])).not.toContain(marker);
    expect(options).toMatchObject({ env: { NODE_ENV: "production", PATH: "/fixed" }, timeout: 12_000, maxBuffer: 524_288, windowsHide: true });
    expect(options.shell).toBeUndefined();
  });
  it.each(["callback", "synchronous"])("never surfaces credentials/raw output from %s errors", async mode => {
    const marker = "controlled-private-failure";
    child.exec.mockImplementation((_file, _args, _options, callback) => {
      if (mode === "synchronous") throw new Error(marker);
      queueMicrotask(() => callback(new Error(marker), marker)); return { stdin: { on: child.on, end: child.input } };
    });
    await expect(hostCommand("cosign", ["verify"], { env: { NODE_ENV: "production" }, input: marker })).rejects.toThrow("no sensitive diagnostics");
    await expect(hostCommand("cosign", ["verify"], { env: { NODE_ENV: "production" } })).rejects.not.toThrow(marker);
  });
});
