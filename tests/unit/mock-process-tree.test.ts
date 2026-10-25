import { afterEach, describe, expect, it, vi } from "vitest";
import { browserGroupKiller, processIdentity, type ProcessIdentity } from "../../services/application-worker/mock-process-tree";
afterEach(() => { vi.useRealTimers(); });
const row = (pid: number, parent: number, group: number, started = "100"): ProcessIdentity => ({ pid, parent, group, started });

describe("owned mock browser process groups", () => {
  it("kills this child's detached Chromium group but not another worker or our parent group", () => {
    vi.useFakeTimers(); const send = vi.fn();
    const tree = browserGroupKiller(200, () => [row(process.pid, 1, 100), row(200, process.pid, 200),
      row(210, 200, 210), row(211, 210, 210), row(300, process.pid, 300), row(310, 300, 310)], send);
    tree.signal("SIGKILL"); tree.close();
    expect(send.mock.calls).toEqual([[-200, "SIGKILL"], [-210, "SIGKILL"]]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains detached child identity after reparenting and refuses recycled PIDs", () => {
    vi.useFakeTimers(); const send = vi.fn(); let reparented = false;
    const tree = browserGroupKiller(200, () => reparented
      ? [row(process.pid, 1, 100), row(200, process.pid, 200, "changed"), row(210, 1, 210)]
      : [row(process.pid, 1, 100), row(200, process.pid, 200), row(210, 200, 210)], send);
    reparented = true; tree.signal("SIGKILL"); tree.close();
    expect(send.mock.calls).toEqual([[-210, "SIGKILL"]]);
  });
  it("parses only numeric process identities, including names containing spaces and parentheses", () => {
    const fields = ["S", "10", "20", ...Array(16).fill("0"), "12345"];
    expect(processIdentity(30, `30 (chrome (test) helper) ${fields.join(" ")}`)).toEqual(row(30, 10, 20, "12345"));
    expect(processIdentity(30, "malformed")).toBeNull();
  });
});
