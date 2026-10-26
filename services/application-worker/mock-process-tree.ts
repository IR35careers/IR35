/** Linux process identities only: never reads command lines, env or secrets. */
import { readFileSync, readdirSync } from "node:fs";

export type ProcessIdentity = { pid: number; parent: number; group: number; started: string };
export function processIdentity(pid: number, stat: string): ProcessIdentity | null {
  const end = stat.lastIndexOf(") ");
  const fields = end < 0 ? [] : stat.slice(end + 2).trim().split(/\s+/);
  if (!Number.isSafeInteger(pid) || pid <= 0 || fields.length < 20 || !/^\d+$/.test(fields[19])) return null;
  const parent = Number(fields[1]), group = Number(fields[2]);
  return Number.isSafeInteger(parent) && parent >= 0 && Number.isSafeInteger(group) && group > 0 ? { pid, parent, group, started: fields[19] } : null;
}
function linuxSnapshot(): ProcessIdentity[] {
  const names = readdirSync("/proc").filter(name => /^\d+$/.test(name));
  if (names.length > 4096) throw new Error("Bounded mock process namespace required.");
  return names.flatMap(name => {
    try { const value = processIdentity(Number(name), readFileSync(`/proc/${name}/stat`, "utf8")); return value ? [value] : []; }
    catch { return []; } // A process exiting between list and read is normal.
  });
}

/** Playwright may detach Chromium into ANOTHER group. Track only descendants
 * of our exact child, fence each PID by start time, and never signal our own
 * group, PID1, a recycled PID, or another worker's browser. */
export function browserGroupKiller(root: number, snapshot = linuxSnapshot, send: (pid: number, signal: NodeJS.Signals) => unknown = process.kill) {
  const groups = new Map<number, Map<number, string>>();
  let rootStarted: string | undefined;
  const collect = (rows: ProcessIdentity[]) => {
    const child = rows.find(row => row.pid === root && row.parent === process.pid);
    if (!child || (rootStarted !== undefined && rootStarted !== child.started)) return;
    rootStarted = child.started;
    const ownGroup = rows.find(row => row.pid === process.pid)?.group;
    if (ownGroup === undefined) return;
    const descendants = new Set([root]);
    for (let size = 0; size !== descendants.size;) {
      size = descendants.size;
      for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid);
    }
    for (const row of rows) {
      if (!descendants.has(row.pid) || row.group <= 1 || row.group === ownGroup || !descendants.has(row.group)) continue;
      const members = groups.get(row.group) ?? new Map<number, string>();
      members.set(row.pid, row.started); groups.set(row.group, members);
    }
  };
  const observe = () => { try { const rows = snapshot(); collect(rows); return rows; } catch { return []; } };
  observe();
  const timer = setInterval(observe, 1000).unref(); // Only while this child is active.
  return {
    signal(signal: NodeJS.Signals) {
      const rows = observe();
      for (const [group, members] of groups) {
        if (!rows.some(row => row.group === group && members.get(row.pid) === row.started)) continue;
        try { send(-group, signal); } catch { /* Already exited; never replace identity. */ }
      }
    },
    close() { clearInterval(timer); },
  };
}
