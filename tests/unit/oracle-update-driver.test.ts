import { describe, expect, it, vi } from "vitest";
import { WorkerMaintenance } from "../../services/application-worker/maintenance";
import { WORKER_IMAGE } from "../../infra/oracle/image-trust";
import { WorkerUpdateDriver, type UpdateDriverPorts } from "../../infra/oracle/update-driver";
import { updateJournalSchema, WorkerUpdateJournal, type UpdateArtifact, type UpdateJournalState } from "../../infra/oracle/update-journal";
import type { HostWorkerHealth, HostWorkerIdentity, HostWorkerObservation } from "../../infra/oracle/worker-host";
import type { WorkerFileSnapshot } from "../../infra/oracle/worker-files";

const at = 1_800_000_000_000;
const artifact = (value: string): UpdateArtifact => ({ image: WORKER_IMAGE + "@sha256:" + value.repeat(64), digest: "sha256:" + value.repeat(64), revision: value.repeat(40) });
const old = artifact("a"), next = artifact("b");
const id = (value: number) => "00000000-0000-4000-8000-" + value.toString(16).padStart(12, "0");
function fixture(mode: "standby" | "consumer" = "standby") {
  let now = at, counter = 0, stops = 0, starts = 0, replacements = 0, localActive = 0, globalSubmitting = 0;
  let releaseStop: (() => void) | null = null;
  let busy = false, candidateDown = false, rollbackDown = false, releaseOnResume = true;
  let beforeSelectionFailure = false, afterSelectionFailure = false, afterReplacementFailure = false;
  const events: string[] = [], saved: UpdateJournalState[] = [];
  let files: WorkerFileSnapshot = { image: old.image, mode, runner: mode === "standby" ? "vercel" : "oracle", accepting: mode === "consumer",
    invariantsHash: "c".repeat(64), deployHash: "d".repeat(64) };
  let identity: HostWorkerIdentity | null = { id: "e".repeat(64), imageId: "sha256:" + "a".repeat(64), image: old.image, status: "running", running: true,
    project: "ir35-worker", service: "worker", bootId: null, ports: [{ HostIp: "127.0.0.1", HostPort: "8787" }] };
  let durable: UpdateJournalState = { version: 2, revision: 0, mode, invariantsHash: files.invariantsHash, stable: { artifact: old, bootId: null },
    previous: null, highWater: old, rejectedDigest: null, transaction: null };
  const controller = (boot?: string) => new WorkerMaintenance({ configuredToAccept: mode === "consumer", initialOperationId: boot,
    stopConsumers: async () => { stops++; if (busy) await new Promise<void>(resolve => { releaseStop = resolve; }); },
    startConsumers: async () => { starts++; },
  });
  let maintenance = controller();
  const healthy = () => identity?.image === next.image ? !candidateDown : identity?.bootId ? !rollbackDown : true;
  const persist = vi.fn(async (state: UpdateJournalState) => {
    durable = structuredClone(state); saved.push(structuredClone(state)); events.push("save:" + (state.transaction?.phase ?? "stable"));
  });
  const observe = vi.fn(async (): Promise<HostWorkerObservation> => {
    await new Promise<void>(resolve => setImmediate(resolve)); // settle the real maintenance controller, not a fake phase transition
    const ok = healthy();
    const health: HostWorkerHealth | null = identity ? { ok, service: "ir35-queue-worker", mode,
      active: localActive, handlersActive: localActive, submitting: ok ? localActive + globalSubmitting : null,
      browserReady: ok, databaseReady: ok, maintenance: maintenance.snapshot() } : null;
    return structuredClone({ files, identity, health, observedAt: now });
  });
  const journalProof = vi.fn(async (sample: HostWorkerObservation) => {
    if (!sample.identity?.running || !sample.health?.ok || !sample.health.maintenance
      || !["idle", "drained"].includes(sample.health.maintenance.phase) || sample.health.submitting === null
      || sample.observedAt > now || now - sample.observedAt > 5000 || JSON.stringify(files) !== JSON.stringify(sample.files)) throw new Error("controlled proof rejection");
    return { observedAt: sample.observedAt, image: sample.identity.image, bootId: sample.identity.bootId,
      invariantsHash: sample.files.invariantsHash, mode: sample.health.mode, ok: true, browserReady: true, databaseReady: true,
      active: sample.health.active, handlersActive: sample.health.handlersActive, submitting: sample.health.submitting, maintenance: sample.health.maintenance };
  });
  const control = vi.fn(async (action: "drain" | "resume", operationId: string, ...extra: [HostWorkerObservation, { notAfter: number }?]) => {
    if (extra[1] && now >= extra[1].notAfter) throw new Error("controlled signing deadline exceeded");
    events.push(action + ":" + operationId);
    maintenance.request({ action, operationId });
    if (action === "resume" && releaseStop && releaseOnResume) { busy = false; localActive = 0; releaseStop(); releaseStop = null; }
  });
  const verifyAndPull = vi.fn(async (image: unknown, immutable: (revision: string, digest: string) => Promise<string>) => {
    events.push("verify:" + image); const value = image === old.image ? old : next;
    expect(await immutable(value.revision, value.digest)).toBe(value.image); return structuredClone(value);
  });
  const replace = vi.fn(async (input: unknown) => {
    const state = updateJournalSchema.parse(input), tx = state.transaction!;
    expect(durable.transaction?.phase).toBe(tx.phase); events.push("replace:" + tx.phase); replacements++;
    if (beforeSelectionFailure) throw new Error("controlled failure before selection");
    const candidate = tx.phase === "candidate_starting", image = candidate ? tx.candidate.image : state.stable.artifact.image;
    files = { ...files, image, deployHash: (candidate ? "f" : "d").repeat(64) };
    if (afterSelectionFailure) throw new Error("controlled unknown acknowledgement after selection");
    identity = { ...identity!, image, imageId: "sha256:" + (candidate ? "b" : "a").repeat(64), id: (candidate ? "f" : "e").repeat(64),
      bootId: candidate ? tx.candidateBootId : tx.rollbackBootId };
    maintenance = controller(identity.bootId!);
    if (afterReplacementFailure) { afterReplacementFailure = false; throw new Error("controlled lost launch acknowledgement"); }
  });
  const host = { observe, journalProof, control, verifyAndPull, replace };
  const registry = {
    verifyReadOnlyScope: vi.fn(async () => { events.push("read-only-scope"); }),
    resolve: vi.fn(async () => next.digest),
    requireImmutableRevision: vi.fn(async (_revision: unknown, digest: unknown) => WORKER_IMAGE + "@" + digest),
    requireSuccessor: vi.fn(async () => { events.push("ancestry"); }),
  };
  const sleep = vi.fn(async (milliseconds: number) => { now += milliseconds; });
  const newDriver = () => new WorkerUpdateDriver(new WorkerUpdateJournal(durable, persist), {
    host, registry, now: () => now, uuid: () => id(++counter), sleep,
  } satisfies UpdateDriverPorts);
  return { host, registry, persist, events, saved, sleep, newDriver, state: () => structuredClone(durable), files: () => structuredClone(files),
    counters: () => ({ stops, starts, replacements }), time: () => now,
    setTime: (value: number) => { now = value; }, setState: (value: UpdateJournalState) => { durable = structuredClone(value); },
    setFiles: (value: Partial<WorkerFileSnapshot>) => { files = { ...files, ...value }; },
    setIdentity: (value: Partial<HostWorkerIdentity>) => { identity = { ...identity!, ...value }; },
    setBusy: () => { busy = true; localActive = mode === "consumer" ? 1 : 0; globalSubmitting = mode === "standby" ? 1 : 0; },
    setGlobal: (value: number) => { globalSubmitting = value; },
    setCandidateDown: () => { candidateDown = true; }, setRollbackDown: () => { rollbackDown = true; },
    preventAbortCompletion: () => { releaseOnResume = false; },
    failBeforeSelection: (value = true) => { beforeSelectionFailure = value; }, failAfterSelection: () => { afterSelectionFailure = true; },
    loseLaunchAck: () => { afterReplacementFailure = true; },
    restartCommitted: () => { maintenance = controller(identity!.bootId!); },
  };
}
function failPersistence(f: ReturnType<typeof fixture>, phase: string, after = true) {
  const real = f.persist.getMockImplementation()!; let failed = false;
  f.persist.mockImplementation(async state => {
    if (!failed && (state.transaction?.phase ?? "stable") === phase) {
      failed = true; if (after) await real(state); throw new Error("controlled private persistence diagnostic");
    }
    await real(state);
  });
}

describe("serial real-journal and real-maintenance update execution", () => {
  it.each(["standby", "consumer"] as const)("updates from verified forward image, preserving cutover configuration: %s", async mode => {
    const f = fixture(mode); const before = f.files();
    expect(await f.newDriver().run()).toEqual({ status: "updated" });
    expect(f.state()).toMatchObject({ transaction: null, stable: { artifact: next, bootId: id(2) }, previous: { artifact: old, bootId: null } });
    expect(f.files()).toMatchObject({ mode: before.mode, runner: before.runner, accepting: before.accepting, invariantsHash: before.invariantsHash });
    expect(f.counters()).toEqual({ stops: mode === "consumer" ? 1 : 0, starts: mode === "consumer" ? 1 : 0, replacements: 1 });
    expect(f.events.indexOf("save:draining")).toBeLessThan(f.events.indexOf("drain:" + id(1)));
    expect(f.events.indexOf("save:candidate_starting")).toBeLessThan(f.events.indexOf("replace:candidate_starting"));
    expect(f.events.indexOf("save:candidate_activating")).toBeLessThan(f.events.indexOf("resume:" + id(2)));
  });
  it("leaves an unchanged/rejected image alone and never drains or rewrites flags", async () => {
    for (const rejected of [false, true]) {
      const f = fixture(); if (rejected) f.setState({ ...f.state(), rejectedDigest: next.digest }); else f.registry.resolve.mockResolvedValue(old.digest);
      expect(await f.newDriver().run()).toEqual({ status: rejected ? "rejected" : "unchanged" });
      expect(f.host.control).not.toHaveBeenCalled(); expect(f.host.replace).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
    }
  });
  it.each(["scope", "unsigned", "ancestry", "missing-tag", "wrong-artifact"])("rejects unverified release before pausing the worker: %s", async failure => {
    const f = fixture();
    if (failure === "scope") f.registry.verifyReadOnlyScope.mockRejectedValue(new Error("controlled private scope"));
    if (failure === "unsigned") f.host.verifyAndPull.mockRejectedValue(new Error("controlled private verifier"));
    if (failure === "ancestry") f.registry.requireSuccessor.mockRejectedValue(new Error("controlled private comparison"));
    if (failure === "missing-tag") f.registry.requireImmutableRevision.mockRejectedValue(new Error("controlled private registry"));
    if (failure === "wrong-artifact") f.host.verifyAndPull.mockResolvedValue({ ...old, revision: next.revision });
    const result = await f.newDriver().run(); expect(result.status).toBe("needs-human"); expect(JSON.stringify(result)).not.toContain("private");
    expect(f.host.control).not.toHaveBeenCalled(); expect(f.host.replace).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it("rechecks owner configuration after slow verification, never undoing an owner change", async () => {
    const f = fixture(); const real = f.host.verifyAndPull.getMockImplementation()!;
    f.host.verifyAndPull.mockImplementation(async (...args) => { const result = await real(...args); if (args[0] === next.image) f.setFiles({ invariantsHash: "f".repeat(64), runner: "oracle" }); return result; });
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "configuration" });
    expect(f.host.control).not.toHaveBeenCalled(); expect(f.files().runner).toBe("oracle");
  });
  it("waits for database-wide Vercel submissions in standby without registering consumers", async () => {
    const f = fixture(); f.setGlobal(1);
    f.sleep.mockImplementation(async milliseconds => { f.setTime(f.time() + milliseconds); if (f.time() >= at + 20_000) f.setGlobal(0); });
    expect(await f.newDriver().run()).toEqual({ status: "updated" }); expect(f.time()).toBeGreaterThanOrEqual(at + 20_000);
    expect(f.counters()).toEqual({ starts: 0, stops: 0, replacements: 1 });
  });
  it.each(["standby", "consumer"] as const)("ten-minute busy deadline resumes existing mode without replacing: %s", async mode => {
    const f = fixture(mode); f.setBusy();
    expect(await f.newDriver().run()).toEqual({ status: "aborted" });
    expect(f.time()).toBeGreaterThanOrEqual(at + 600_000); expect(f.time()).toBeLessThan(at + 720_000);
    expect(f.state().stable.artifact).toEqual(old); expect(f.state().transaction).toBeNull(); expect(f.counters().replacements).toBe(0);
    expect(f.files()).toMatchObject({ accepting: mode === "consumer", runner: mode === "consumer" ? "oracle" : "vercel" });
  });
  it("a lost drain never causes a final-window retry or resets the original deadline", async () => {
    const f = fixture(); failPersistence(f, "draining"); await f.newDriver().run();
    const original = f.state().transaction!; f.setTime(original.drainDeadline - 10_000);
    f.host.control.mockRejectedValue(new Error("controlled absent drain"));
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "operator" });
    expect(f.host.control).not.toHaveBeenCalled(); expect(f.host.replace).not.toHaveBeenCalled();
    expect(f.time()).toBe(original.drainDeadline); expect(f.state().transaction).toMatchObject({ drainId: original.drainId, phase: "failed", reason: "busy" });
  });
  it("arms original-worker resume while offWork is still waiting, without forced cancellation", async () => {
    const f = fixture("consumer"); f.setBusy(); f.preventAbortCompletion();
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "operator" });
    expect(f.state().transaction).toMatchObject({ phase: "failed", reason: "activation_uncertain" });
    expect(f.counters()).toEqual({ starts: 0, stops: 1, replacements: 0 });
    expect(f.host.control.mock.calls.filter(call => call[0] === "resume")).toHaveLength(2);
  });
  it("a pre-resume unhealthy candidate automatically restores the signed previous generation and records rejection", async () => {
    const f = fixture(); f.setCandidateDown();
    expect(await f.newDriver().run()).toEqual({ status: "rolled-back" });
    expect(f.state()).toMatchObject({ transaction: null, stable: { artifact: old, bootId: id(3) }, rejectedDigest: next.digest });
    expect(f.counters().replacements).toBe(2);
    expect(await f.newDriver().run()).toEqual({ status: "rejected" }); expect(f.counters().replacements).toBe(2);
  });
  it("failed rollback stops at its original two-minute deadline rather than recreating again", async () => {
    const f = fixture(); f.setCandidateDown(); f.setRollbackDown();
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "operator" });
    expect(f.state().transaction).toMatchObject({ phase: "failed", reason: "rollback_failed" });
    expect(f.counters().replacements).toBe(2);
    const calls = f.host.verifyAndPull.mock.calls.length;
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "operator" });
    expect(f.host.verifyAndPull).toHaveBeenCalledTimes(calls);
  });
  it("a lost launch acknowledgement reconciles the actual paused target, never running Compose twice", async () => {
    const f = fixture(); f.loseLaunchAck();
    expect(await f.newDriver().run()).toEqual({ status: "updated" }); expect(f.counters().replacements).toBe(1);
  });
  it("an ambiguous post-selection old generation is not a blind launch or rollback target", async () => {
    const f = fixture(); f.failAfterSelection();
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "operator" });
    expect(f.counters().replacements).toBe(1); expect(f.state().transaction?.phase).toBe("failed");
    expect(f.host.control.mock.calls.filter(call => call[0] === "resume")).toHaveLength(0);
  });
  it("a confirmed unselected failed launch resumes the original worker and rejects that image", async () => {
    const f = fixture(); f.failBeforeSelection();
    expect(await f.newDriver().run()).toEqual({ status: "aborted" });
    expect(f.state()).toMatchObject({ stable: { artifact: old }, rejectedDigest: next.digest, transaction: null });
    expect(f.counters().replacements).toBe(1);
  });
  it.each(["draining", "candidate_starting", "candidate_activating", "aborting", "rollback_starting", "rollback_activating", "stable"])("reloads durable acknowledgement loss at %s without changing generations/deadlines", async phase => {
    const f = fixture(phase === "aborting" ? "consumer" : "standby"); if (phase.startsWith("rollback")) f.setCandidateDown(); if (phase === "aborting") f.setBusy();
    failPersistence(f, phase); const first = await f.newDriver().run(); expect(first.status).toBe("needs-human");
    const before = f.state(), originalDeadline = before.transaction?.drainDeadline;
    const result = await f.newDriver().run();
    expect(["updated", "rolled-back", "unchanged", "aborted"]).toContain(result.status);
    expect(f.saved.every(value => !value.transaction || value.transaction.drainDeadline === (originalDeadline ?? at + 600_000))).toBe(true);
    expect(f.counters().replacements).toBe(phase === "aborting" ? 0 : phase.startsWith("rollback") ? 2 : 1);
  });
  it("expired unselected replacement recovery aborts without restarting its two-minute launch window", async () => {
    const f = fixture(); failPersistence(f, "candidate_starting"); await f.newDriver().run();
    const original = f.state().transaction!; f.setTime(original.healthDeadline! + 1);
    expect(await f.newDriver().run()).toEqual({ status: "aborted" });
    expect(f.host.replace).not.toHaveBeenCalled(); expect(f.state().rejectedDigest).toBe(next.digest);
  });
  it("an already resumed candidate with lost acknowledgement commits from fresh physical evidence only", async () => {
    const f = fixture("consumer"); const real = f.host.control.getMockImplementation()!;
    f.host.control.mockImplementation(async (...args) => { await real(...args); if (args[0] === "resume") throw new Error("controlled lost resume acknowledgement"); });
    expect(await f.newDriver().run()).toEqual({ status: "updated" });
    expect(f.counters()).toEqual({ starts: 1, stops: 1, replacements: 1 });
  });
  it("never rolls back a possibly resumed candidate when readiness subsequently fails", async () => {
    const f = fixture("consumer"), real = f.host.control.getMockImplementation()!;
    f.host.control.mockImplementation(async (...args) => { await real(...args); if (args[0] === "resume") { f.setCandidateDown(); throw new Error("controlled unknown resume result"); } });
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "operator" });
    expect(f.state().transaction).toMatchObject({ phase: "failed", reason: "activation_uncertain" }); expect(f.counters().replacements).toBe(1);
  });
  it("a foreign target boot is never resumed or removed", async () => {
    const f = fixture(), real = f.host.replace.getMockImplementation()!;
    f.host.replace.mockImplementation(async input => { await real(input); f.setIdentity({ bootId: id(99) }); });
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "physical" });
    expect(f.host.control.mock.calls.filter(call => call[0] === "resume")).toHaveLength(0); expect(f.counters().replacements).toBe(1);
  });
  it("clock regression aborts only the original known drain, never selecting a replacement", async () => {
    const f = fixture("consumer"); f.setBusy(); let first = true;
    f.sleep.mockImplementation(async ms => { f.setTime(f.time() + (first ? -1 : ms)); first = false; });
    expect(await f.newDriver().run()).toEqual({ status: "aborted" });
    expect(f.saved.some(value => value.transaction?.reason === "clock_skew")).toBe(true); expect(f.counters().replacements).toBe(0);
  });
  it("a frozen clock cannot create a busy loop or extend a deadline", async () => {
    const f = fixture("consumer"); f.setBusy(); f.sleep.mockImplementation(async () => {});
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "clock" });
    expect(f.sleep).toHaveBeenCalledTimes(3); expect(f.counters().replacements).toBe(0);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])("rejects invalid clock before any external verification or action: %s", async value => {
    const f = fixture(); f.setTime(value);
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "clock" });
    expect(f.registry.verifyReadOnlyScope).not.toHaveBeenCalled(); expect(f.host.observe).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it("recovers an already committed boot pause, without another image update or main lookup", async () => {
    const f = fixture("consumer"); expect(await f.newDriver().run()).toEqual({ status: "updated" });
    const stable = f.state().stable; f.restartCommitted();
    expect(await f.newDriver().run()).toEqual({ status: "recovered" }); expect(f.state().stable).toEqual(stable);
    expect(f.registry.resolve).toHaveBeenCalledTimes(1); expect(f.counters()).toEqual({ replacements: 1, stops: 1, starts: 2 });
  });
  it("the same driver instance cannot execute concurrent or repeated update loops", async () => {
    const f = fixture(), driver = f.newDriver();
    const results = await Promise.all([driver.run(), driver.run()]);
    expect(results).toEqual([{ status: "updated" }, { status: "needs-human", reason: "operator" }]);
    expect(await driver.run()).toEqual({ status: "needs-human", reason: "operator" }); expect(f.counters().replacements).toBe(1);
  });
  it("a clock regression inside verification stops before the drain intent or command", async () => {
    const f = fixture(), real = f.host.verifyAndPull.getMockImplementation()!;
    f.host.verifyAndPull.mockImplementation(async (...args) => { const result = await real(...args); if (args[0] === next.image) f.setTime(at - 1); return result; });
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "clock" });
    expect(f.persist).not.toHaveBeenCalled(); expect(f.host.control).not.toHaveBeenCalled();
  });
  it("the durable high-water revision prevents replaying an earlier failed image after a later failure", async () => {
    const f = fixture(), later = artifact("c");
    f.setState({ ...f.state(), highWater: later, rejectedDigest: later.digest });
    f.registry.requireSuccessor.mockImplementation(async (...args: unknown[]) => { if (args[0] === later.revision) throw new Error("controlled older attempted release"); });
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "uncertain" });
    expect(f.registry.requireSuccessor).toHaveBeenCalledWith(later.revision, next.revision);
    expect(f.host.control).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled(); expect(f.state().highWater).toEqual(later);
  });
  it("the same busy but never-rejected watermark can retry after global work finishes", async () => {
    const f = fixture(); f.setGlobal(1);
    expect(await f.newDriver().run()).toEqual({ status: "aborted" }); expect(f.state().highWater).toEqual(next);
    expect(f.state().rejectedDigest).toBeNull(); f.setGlobal(0);
    expect(await f.newDriver().run()).toEqual({ status: "updated" }); expect(f.counters().replacements).toBe(1);
  });
  it("journal latency cannot send a newly valid drain command inside the final expiry window", async () => {
    const f = fixture(); failPersistence(f, "draining"); await f.newDriver().run();
    const deadline = f.state().transaction!.drainDeadline; f.setTime(deadline - 40_000);
    const real = f.persist.getMockImplementation()!;
    f.persist.mockImplementation(async state => { await real(state); if (state.transaction?.phase === "draining") f.setTime(deadline - 20_000); });
    expect(await f.newDriver().run()).toEqual({ status: "needs-human", reason: "operator" });
    expect(f.host.control).toHaveBeenCalledTimes(1); expect(f.host.control.mock.calls[0][3]).toEqual({ notAfter: deadline - 31_000 });
    expect(f.events.filter(value => value.startsWith("drain:"))).toEqual([]); expect(f.host.replace).not.toHaveBeenCalled();
  });
});
