import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
const nativeSpawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>(), spawn: nativeSpawn }));
vi.mock("../../services/application-worker/mock-process-tree", () => ({ browserGroupKiller: (pid: number) => ({
  signal: (signal: NodeJS.Signals) => process.kill(-pid, signal), close: () => undefined,
}) }));
import { runMockBrowser } from "../../services/application-worker/mock-runtime";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); nativeSpawn.mockReset(); });

function child() {
  const processChild = Object.assign(new EventEmitter(), { pid: 987654, stdout: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn<(signal: NodeJS.Signals) => boolean>() });
  const signals: NodeJS.Signals[] = [];
  const kill = (signal: NodeJS.Signals): true => {
    signals.push(signal);
    if (signal === "SIGKILL") processChild.emit("close", 1);
    return true;
  };
  processChild.kill.mockImplementation(kill);
  vi.spyOn(process, "kill").mockImplementation((_pid, signal) => kill(signal as NodeJS.Signals));
  nativeSpawn.mockReturnValue(processChild);
  return { processChild, signals };
}

describe("bounded isolated browser process cleanup", () => {
  it("escalates an ignored SIGTERM after five seconds and waits for the child to close", async () => {
    vi.useFakeTimers(); const { signals } = child(); const controller = new AbortController();
    const pending = runMockBrowser({ operation: "apply", scenario: "timeout" }, controller.signal);
    const rejected = expect(pending).rejects.toThrow("Mock browser child failed");
    controller.abort();
    expect(signals).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(4999);
    expect(signals).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(signals).toContain("SIGKILL");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts only a clean bounded result and removes all abort timers", async () => {
    vi.useFakeTimers(); const { processChild } = child();
    const pending = runMockBrowser({ operation: "health" });
    processChild.stdout.write(JSON.stringify({ ok: true, browserReady: true, submissions: 0 }));
    processChild.emit("close", 0);
    await expect(pending).resolves.toEqual({ ok: true, browserReady: true, submissions: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
