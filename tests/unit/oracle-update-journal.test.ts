import { describe, expect, it, vi } from "vitest";
import { updateJournalSchema, WorkerUpdateJournal, type UpdateJournalState } from "../../infra/oracle/update-journal";
import { WORKER_IMAGE } from "../../infra/oracle/image-trust";

const now = 1_800_000_000_000;
const artifact = (value: string) => ({ image: `${WORKER_IMAGE}@sha256:${value.repeat(64)}`, digest: `sha256:${value.repeat(64)}`, revision: value.repeat(40) });
const old = artifact("a"); const candidate = artifact("b");
const ids = { drainId: "00000000-0000-4000-8000-000000000001", candidateBootId: "00000000-0000-4000-8000-000000000002", rollbackBootId: "00000000-0000-4000-8000-000000000003" };
const initial = (): UpdateJournalState => ({ version: 1, revision: 0, mode: "standby", invariantsHash: "c".repeat(64),
  stable: { artifact: old, bootId: null }, previous: null, transaction: null, rejectedDigest: null });
const proof = (image = old.image, bootId: string | null = null, operationId: string | null = ids.drainId, at = now + 1) => ({
  observedAt: at, image, bootId, invariantsHash: "c".repeat(64), mode: "standby", ok: true, browserReady: true, databaseReady: true,
  active: 0, handlersActive: 0, submitting: 0,
  maintenance: operationId ? { phase: "drained", operationId, safeToReplace: true } : { phase: "idle", operationId: null, safeToReplace: false },
});
function fixture(mode: "standby" | "consumer" = "standby") {
  let durable = { ...initial(), mode }; const events: string[] = [];
  const persist = vi.fn(async (value: UpdateJournalState) => { durable = structuredClone(value); events.push(`save:${value.transaction?.phase ?? "stable"}`); });
  const effect = vi.fn(async () => { events.push("effect"); });
  const journal = new WorkerUpdateJournal(durable, persist);
  return { journal, persist, effect, events, durable: () => structuredClone(durable) };
}
const begin = (f: ReturnType<typeof fixture>) => f.journal.begin({ candidate, ...ids, now }, f.effect);

describe("durable worker update journal before side effects", () => {
  it("persists every decision before stop/replace/resume, then confirms the actual resumed candidate", async () => {
    const f = fixture("consumer"); await begin(f); // data-only test, no environment/acceptance change
    await f.journal.startCandidate({ ...proof(), mode: "consumer" }, now + 1, f.effect);
    await f.journal.activateCandidate({ ...proof(candidate.image, ids.candidateBootId, ids.candidateBootId, now + 2), mode: "consumer" }, now + 2, f.effect);
    expect(f.durable().transaction?.phase).toBe("candidate_activating"); // commit decision before any possibly lost resume ack
    const resumed = { ...proof(candidate.image, ids.candidateBootId, null, now + 3), mode: "consumer", active: 1, handlersActive: 1, submitting: 1 };
    await f.journal.confirmCandidate(resumed, now + 3);
    expect(f.events).toEqual(["save:draining", "effect", "save:candidate_starting", "effect", "save:candidate_activating", "effect", "save:stable"]);
    expect(f.durable()).toMatchObject({ revision: 4, transaction: null, stable: { artifact: candidate, bootId: ids.candidateBootId }, previous: { artifact: old, bootId: null }, mode: "consumer", invariantsHash: "c".repeat(64) });
  });
  it("a failed journal acknowledgement never invokes the external effect or mutates the local snapshot", async () => {
    const f = fixture(); f.persist.mockRejectedValueOnce(new Error("controlled private storage failure"));
    await expect(begin(f)).rejects.toThrow("reload durable state"); expect(f.effect).not.toHaveBeenCalled();
    expect(() => f.journal.snapshot()).toThrow("reload durable state");
    await expect(begin(f)).rejects.toThrow("reload durable state"); expect(f.effect).not.toHaveBeenCalled();
    expect(f.durable()).toEqual(initial());
  });
  it("a journal write that succeeds but loses its acknowledgement still forbids stale-object retry", async () => {
    const f = fixture(); const original = f.persist.getMockImplementation()!;
    f.persist.mockImplementationOnce(async state => { await original(state); throw new Error("controlled-never-log"); });
    await expect(begin(f)).rejects.toThrow("reload durable state"); expect(f.effect).not.toHaveBeenCalled();
    await expect(begin(f)).rejects.not.toThrow("controlled-never-log");
    const reloaded = new WorkerUpdateJournal(f.durable(), f.persist);
    expect(reloaded.snapshot().transaction?.phase).toBe("draining");
    await reloaded.retryDrain(proof(old.image, null, null), now + 1, f.effect);
    expect(f.effect).toHaveBeenCalledTimes(1);
  });
  it("unknown command acknowledgement retains its exact persisted intent without raw error details or blind replay", async () => {
    const f = fixture(); f.effect.mockRejectedValueOnce(new Error("controlled-never-echo"));
    expect(await begin(f)).toEqual({ acknowledged: false });
    expect(JSON.stringify(f.journal.snapshot())).not.toContain("controlled-never-echo");
    const reloaded = new WorkerUpdateJournal(f.durable(), f.persist);
    expect(reloaded.snapshot().transaction).toMatchObject({ drainId: ids.drainId, drainDeadline: now + 600_000, phase: "draining" });
    await expect(reloaded.begin({ candidate, ...ids, now: now + 1000 }, f.effect)).rejects.toThrow("already active");
  });
  it.each([
    { active: 1 }, { handlersActive: 1 }, { submitting: 1 }, { image: candidate.image }, { mode: "consumer" },
    { invariantsHash: "d".repeat(64) }, { bootId: ids.candidateBootId }, { observedAt: now - 5001 }, { observedAt: now + 10 },
    { maintenance: { phase: "idle", operationId: null, safeToReplace: false } },
    { maintenance: { phase: "drained", operationId: ids.rollbackBootId, safeToReplace: true } },
  ])("cannot replace from a busy, stale, wrong-generation/mode/config/operation proof: %j", async change => {
    const f = fixture(); await begin(f); f.effect.mockClear();
    await expect(f.journal.startCandidate({ ...proof(), ...change }, now + 1, f.effect)).rejects.toThrow();
    expect(f.effect).not.toHaveBeenCalled(); expect(f.durable().transaction?.phase).toBe("draining");
  });
  it("ten-minute expiry or backwards clock aborts with an old-worker resume, no replacement/deadline reset", async () => {
    for (const at of [now + 600_000, now - 1]) {
      const f = fixture(); await begin(f); f.effect.mockClear();
      await expect(f.journal.startCandidate(proof(), at, f.effect)).rejects.toThrow("deadline expired"); expect(f.effect).not.toHaveBeenCalled();
      await f.journal.abort(at, at < now ? "clock_skew" : "busy", f.effect);
      expect(f.durable().transaction).toMatchObject({ phase: "aborting", drainDeadline: now + 600_000 });
      await f.journal.confirmAbort(proof(old.image, null, null, at), at);
      expect(f.durable().stable).toEqual(initial().stable); expect(f.durable().transaction).toBeNull();
    }
  });
  it("failed pre-resume health restores the preceding release under a DIFFERENT boot generation", async () => {
    const f = fixture(); await begin(f); await f.journal.startCandidate(proof(), now + 1, f.effect);
    await expect(f.journal.activateCandidate(proof(candidate.image, ids.candidateBootId, ids.candidateBootId, now + 120_001), now + 120_001, f.effect)).rejects.toThrow("deadline expired");
    await f.journal.startRollback(now + 120_002, "health_failed", f.effect);
    await expect(f.journal.activateRollback(proof(old.image, ids.candidateBootId, ids.candidateBootId, now + 120_003), now + 120_003, f.effect)).rejects.toThrow();
    await f.journal.activateRollback(proof(old.image, ids.rollbackBootId, ids.rollbackBootId, now + 120_003), now + 120_003, f.effect);
    await f.journal.confirmRollback(proof(old.image, ids.rollbackBootId, null, now + 120_004), now + 120_004);
    expect(f.durable()).toMatchObject({ stable: { artifact: old, bootId: ids.rollbackBootId }, previous: null, transaction: null, rejectedDigest: candidate.digest });
    await expect(f.journal.begin({ candidate, ...ids, now: now + 1_000_000 }, f.effect)).rejects.toThrow("ineligible");
  });
  it("cannot roll back after the durable resume decision: a real application may already be submitting", async () => {
    const f = fixture(); await begin(f); await f.journal.startCandidate(proof(), now + 1, f.effect);
    f.effect.mockRejectedValueOnce(new Error("controlled lost resume acknowledgement"));
    expect(await f.journal.activateCandidate(proof(candidate.image, ids.candidateBootId, ids.candidateBootId, now + 2), now + 2, f.effect)).toEqual({ acknowledged: false });
    const reloaded = new WorkerUpdateJournal(f.durable(), f.persist);
    await expect(reloaded.startRollback(now + 3, "health_failed", f.effect)).rejects.toThrow("Invalid worker update journal transition");
    await reloaded.fail("activation_uncertain", now + 3);
    expect(f.durable().transaction?.phase).toBe("failed");
    await expect(reloaded.startRollback(now + 4, "health_failed", f.effect)).rejects.toThrow();
  });
  it("lost control acknowledgements replay only the same operation/deadline and a proved paused target", async () => {
    const f = fixture(); await begin(f);
    await f.journal.retryDrain(proof(old.image, null, null), now + 1, f.effect);
    expect(f.durable().transaction?.drainDeadline).toBe(now + 600_000);
    await f.journal.startCandidate(proof(), now + 1, f.effect);
    await f.journal.activateCandidate(proof(candidate.image, ids.candidateBootId, ids.candidateBootId, now + 2), now + 2, f.effect);
    const deadline = f.durable().transaction?.healthDeadline;
    await f.journal.retryResume(proof(candidate.image, ids.candidateBootId, ids.candidateBootId, now + 3), now + 3, f.effect);
    expect(f.durable().transaction?.healthDeadline).toBe(deadline);
    await expect(f.journal.retryResume(proof(candidate.image, ids.candidateBootId, ids.candidateBootId, now + 120_002), now + 120_002, f.effect)).rejects.toThrow("uncertain");
  });
  it("a committed container restart can resume only its known boot generation with no image or mode change", async () => {
    const f = fixture(); const state = { ...initial(), stable: { artifact: old, bootId: ids.rollbackBootId } };
    const journal = new WorkerUpdateJournal(state, f.persist);
    await journal.recoverStableBoot(proof(old.image, ids.rollbackBootId, ids.rollbackBootId), now + 1, f.effect);
    expect(f.durable().stable).toEqual(state.stable); expect(f.durable().transaction).toBeNull(); expect(f.durable().mode).toBe("standby");
    await expect(journal.recoverStableBoot(proof(old.image, ids.candidateBootId, ids.candidateBootId), now + 1, f.effect)).rejects.toThrow();
  });
  it("malformed/extended deadlines, reused generations and mutation of a caller snapshot cannot corrupt decisions", async () => {
    const f = fixture(); await begin(f); const bad = f.durable(); bad.transaction!.drainDeadline++;
    expect(updateJournalSchema.safeParse(bad).success).toBe(false);
    const reused = f.durable(); reused.transaction!.candidateBootId = ids.drainId;
    expect(updateJournalSchema.safeParse(reused).success).toBe(false);
    const missing = f.durable(); missing.transaction!.phase = "candidate_starting";
    expect(updateJournalSchema.safeParse(missing).success).toBe(false);
    const caller = f.journal.snapshot(); caller.transaction!.phase = "failed";
    expect(f.journal.snapshot().transaction?.phase).toBe("draining");
  });
});
