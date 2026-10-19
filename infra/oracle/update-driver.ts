import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MAINTENANCE_COMMAND_MAX_AGE_MS } from "../../services/application-worker/maintenance";
import { digestSchema, WORKER_IMAGE } from "./image-trust";
import { WorkerRegistry } from "./registry";
import { WorkerHost, type HostWorkerObservation } from "./worker-host";
import { WorkerFiles } from "./worker-files";
import { updateArtifactSchema, updateJournalSchema, WorkerUpdateJournal, type UpdateArtifact, type UpdateJournalState } from "./update-journal";

type Host = Pick<WorkerHost, "observe" | "journalProof" | "control" | "verifyAndPull" | "replace">;
type Registry = Pick<WorkerRegistry, "verifyReadOnlyScope" | "resolve" | "requireImmutableRevision" | "requireSuccessor">;
export type UpdateDriverPorts = { host: Host; registry: Registry; now?: () => number; uuid?: () => string; sleep?: (milliseconds: number) => Promise<void> };
export type UpdateDriverResult = { status: "unchanged" | "updated" | "rolled-back" | "aborted" | "recovered" | "rejected" | "needs-human";
  reason?: "configuration" | "physical" | "clock" | "deadline" | "operator" | "uncertain" };
class Stop extends Error { constructor(readonly reason: NonNullable<UpdateDriverResult["reason"]>) { super("Worker update stopped safely."); } }
const epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 600_000);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

/** Serial real-journal interpreter. Caller MUST hold the shared Linux flock.
 * No installer, automatic bootstrap, timer, flag writes or employer calls. */
export class WorkerUpdateDriver {
  private readonly attempts = new Map<string, number>();
  private readonly clock: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly uuid: () => string;
  private used = false;
  constructor(private readonly journal: WorkerUpdateJournal, private readonly ports: UpdateDriverPorts) {
    this.clock = ports.now ?? Date.now; this.sleep = ports.sleep ?? pause; this.uuid = ports.uuid ?? randomUUID;
  }
  private now() { const parsed = epoch.safeParse(this.clock()); if (!parsed.success) throw new Stop("clock"); return parsed.data; }
  private atLeast(floor: number) { const now = this.now(); if (now < floor) throw new Stop("clock"); return now; }
  private can(key: string, maximum = 2) { return (this.attempts.get(key) ?? 0) < maximum; }
  private async control(action: "drain" | "resume", id: string, observed: HostWorkerObservation, stableDeadline?: number) {
    const key = action + ":" + id; this.attempts.set(key, (this.attempts.get(key) ?? 0) + 1);
    const tx = this.journal.snapshot().transaction;
    const notAfter = action === "drain" ? tx!.drainDeadline - MAINTENANCE_COMMAND_MAX_AGE_MS - 1000
      : tx ? tx.healthDeadline ?? tx.phaseAt + 120_000 : stableDeadline;
    if (notAfter === undefined) throw new Stop("deadline");
    // Host checks this against its actual signing timestamp AFTER private-file
    // reads and freshness checks, not just before journal fsync/transport work.
    await this.ports.host.control(action, id, observed, { notAfter });
  }
  private async replace(observed: HostWorkerObservation) {
    const state = this.journal.snapshot(); const tx = state.transaction!;
    const key = "replace:" + tx.phase; this.attempts.set(key, (this.attempts.get(key) ?? 0) + 1);
    await this.ports.host.replace(state, observed);
  }
  private binding(observed: HostWorkerObservation, state: UpdateJournalState) {
    const files = observed.files;
    if (files.invariantsHash !== state.invariantsHash || files.mode !== state.mode
      || files.mode !== (files.accepting ? "consumer" : "standby") || (files.accepting && files.runner === "vercel")) throw new Stop("configuration");
  }
  private owns(observed: HostWorkerObservation, image: string, bootId: string | null) {
    return observed.identity?.image === image && observed.identity.bootId === bootId;
  }
  private ready(observed: HostWorkerObservation) {
    const h = observed.health;
    return !!observed.identity?.running && !!h?.ok && h.browserReady && h.databaseReady && h.submitting !== null && !!h.maintenance;
  }
  private idle(observed: HostWorkerObservation) {
    const h = observed.health;
    return this.ready(observed) && h!.maintenance!.phase === "idle" && h!.maintenance!.operationId === null && !h!.maintenance!.safeToReplace;
  }
  private paused(observed: HostWorkerObservation, operationId: string) {
    const h = observed.health;
    return this.ready(observed) && h!.active === 0 && h!.handlersActive === 0 && h!.submitting === 0
      && h!.maintenance!.phase === "drained" && h!.maintenance!.operationId === operationId && h!.maintenance!.safeToReplace;
  }
  private async prepare(expected: UpdateArtifact) {
    const actual = updateArtifactSchema.parse(await this.ports.host.verifyAndPull(expected.image,
      (revision, digest) => this.ports.registry.requireImmutableRevision(revision, digest)));
    if (!same(actual, expected)) throw new Stop("physical");
  }
  private async fail(reason: "busy" | "clock_skew" | "launch_failed" | "health_failed" | "configuration_changed" | "activation_uncertain" | "rollback_failed") {
    await this.journal.fail(reason, this.now());
    throw new Stop(reason === "clock_skew" ? "clock" : "operator");
  }
  async run(): Promise<UpdateDriverResult> {
    if (this.used) return { status: "needs-human", reason: "operator" };
    this.used = true; // one serial invocation; reload durable state for the next
    let outcome: UpdateDriverResult["status"] = "unchanged";
    let recoveringStable = false, stableDeadline = 0, lastTime: number | null = null, stalled = 0;
    try {
      let state = this.journal.snapshot();
      if (state.transaction?.phase === "failed") throw new Stop("operator");
      lastTime = this.now();
      const initial = await this.ports.host.observe(); this.binding(initial, state);
      await this.ports.registry.verifyReadOnlyScope(); await this.prepare(state.stable.artifact);
      if (state.transaction) {
        await this.prepare(state.transaction.candidate);
        await this.ports.registry.requireSuccessor(state.stable.artifact.revision, state.transaction.candidate.revision);
      }
      // Bounded even if an injected/failed clock or sleep never progresses.
      for (let step = 0; step < 650; step++) {
        state = this.journal.snapshot();
        if (state.transaction?.phase === "failed") throw new Stop("operator");
        const observed = await this.ports.host.observe(); this.binding(observed, state);
        const now = this.now(); const tx = state.transaction;
        const stable = this.owns(observed, state.stable.artifact.image, state.stable.bootId);
        const stableFiles = observed.files.image === state.stable.artifact.image;
        const maintenance = observed.health?.maintenance;
        const backwards = (lastTime !== null && now < lastTime) || (!!tx && now < tx.phaseAt);
        lastTime = now;
        if (backwards) {
          if (tx?.phase === "draining" && stable && stableFiles && maintenance?.operationId === tx.drainId) {
            await this.journal.abort(now, "clock_skew", () => this.control("resume", tx.drainId, observed));
            continue;
          }
          if (tx) await this.fail("clock_skew");
          throw new Stop("clock");
        }
        if (!tx) {
          if (!stable || !stableFiles) throw new Stop("physical");
          if (this.idle(observed)) {
            // Local standby handlers must be zero. Global submissions may
            // belong to Vercel; every paused replacement requires global zero.
            await this.ports.host.journalProof(observed);
            if (recoveringStable) return { status: "recovered" };
            if (outcome !== "unchanged") return { status: outcome };
            const resolved = await this.ports.registry.resolve("main");
            if (resolved === null) throw new Stop("physical");
            const digest = digestSchema.parse(resolved);
            if (digest === state.stable.artifact.digest) return { status: "unchanged" };
            if (digest === state.rejectedDigest) return { status: "rejected" };
            const image = WORKER_IMAGE + "@" + digest;
            const candidate = updateArtifactSchema.parse(await this.ports.host.verifyAndPull(image,
              (revision, actual) => this.ports.registry.requireImmutableRevision(revision, actual)));
            if (candidate.image !== image) throw new Stop("physical");
            await this.ports.registry.requireSuccessor(state.stable.artifact.revision, candidate.revision);
            // Failed/busy attempts also advance the durable release watermark.
            // Do not replay an earlier failed image after a later failure has
            // replaced the single rejectedDigest. The same busy image may retry.
            if (state.highWater.image !== candidate.image && state.highWater.image !== state.stable.artifact.image)
              await this.ports.registry.requireSuccessor(state.highWater.revision, candidate.revision);
            const fresh = await this.ports.host.observe(); this.binding(fresh, state);
            if (!this.owns(fresh, state.stable.artifact.image, state.stable.bootId) || !this.idle(fresh)
              || fresh.files.image !== state.stable.artifact.image) throw new Stop("physical");
            const drainId = z.uuid().parse(this.uuid());
            await this.journal.begin({ candidate, drainId, candidateBootId: this.uuid(), rollbackBootId: this.uuid(), now: this.atLeast(now) },
              () => this.control("drain", drainId, fresh));
            continue;
          }
          if (state.stable.bootId && this.paused(observed, state.stable.bootId)) {
            if (!recoveringStable) { recoveringStable = true; stableDeadline = now + 120_000; }
            if (now >= stableDeadline) throw new Stop("deadline");
            if (this.can("resume:" + state.stable.bootId)) {
              await this.journal.recoverStableBoot(await this.ports.host.journalProof(observed), this.atLeast(now),
                () => this.control("resume", state.stable.bootId!, observed, stableDeadline));
              continue;
            }
          } else if (!recoveringStable) throw new Stop("physical");
          else if (now >= stableDeadline) throw new Stop("deadline");
        } else if (tx.phase === "draining") {
          if (!stable || !stableFiles) throw new Stop("physical");
          if (maintenance?.operationId && maintenance.operationId !== tx.drainId) throw new Stop("physical");
          if (now >= tx.drainDeadline) {
            // Idle alone cannot prove cancellation of a lost drain request.
            // Retain the UUID/failed intent for reconciliation, not a false
            // successful abort (including a later clock/transport ambiguity).
            if (this.idle(observed)) await this.fail("busy");
            else if (maintenance?.operationId === tx.drainId && maintenance.phase !== "failed")
              await this.journal.abort(this.atLeast(now), "busy", () => this.control("resume", tx.drainId, observed));
            else throw new Stop("physical");
            continue;
          }
          if (this.paused(observed, tx.drainId)) {
            await this.journal.startCandidate(await this.ports.host.journalProof(observed), this.atLeast(now), () => this.replace(observed));
            continue;
          }
          if (this.idle(observed) && now < tx.drainDeadline - MAINTENANCE_COMMAND_MAX_AGE_MS - 1000 && this.can("drain:" + tx.drainId)) {
            await this.journal.retryDrain(await this.ports.host.journalProof(observed), this.atLeast(now), () => this.control("drain", tx.drainId, observed));
            continue;
          }
          if (maintenance?.phase === "failed") throw new Stop("operator");
        } else if (tx.phase === "candidate_starting" || tx.phase === "rollback_starting") {
          const candidate = tx.phase === "candidate_starting";
          const target = candidate ? tx.candidate.image : state.stable.artifact.image;
          const boot = candidate ? tx.candidateBootId : tx.rollbackBootId;
          const selected = observed.files.image === target;
          const targetOwned = this.owns(observed, target, boot);
          if (targetOwned && selected && this.paused(observed, boot) && now < tx.healthDeadline!) {
            const proof = await this.ports.host.journalProof(observed);
            const resume = () => this.control("resume", boot, observed);
            if (candidate) await this.journal.activateCandidate(proof, this.atLeast(now), resume);
            else await this.journal.activateRollback(proof, this.atLeast(now), resume);
            continue;
          }
          if (targetOwned && maintenance && (maintenance.phase !== "drained" || maintenance.operationId !== boot))
            await this.fail("activation_uncertain"); // never remove a possibly resumed target
          const source = candidate ? stable : this.owns(observed, tx.candidate.image, tx.candidateBootId);
          const sourceImage = candidate ? state.stable.artifact.image : tx.candidate.image;
          const unselected = observed.files.image === sourceImage;
          if (observed.identity && !targetOwned && !source) throw new Stop("physical");
          if (now >= tx.healthDeadline!) {
            if (!candidate) await this.fail("rollback_failed");
            if (stable && stableFiles && this.paused(observed, tx.drainId)) {
              await this.journal.abortUnselected(await this.ports.host.journalProof(observed), this.atLeast(now), () => this.control("resume", tx.drainId, observed));
            } else if (selected && (targetOwned || !observed.identity)) {
              await this.journal.startRollback(this.atLeast(now), "health_failed", () => this.replace(observed));
            } else await this.fail("activation_uncertain");
            continue;
          }
          // Positive pre-selection proof, not a blind Compose replay. After
          // selection is written, only observe its original generation/deadline.
          if (unselected && source && this.can("replace:" + tx.phase, 1)) {
            if (!candidate || this.paused(observed, tx.drainId)) {
              await this.journal.retryUnselectedReplacement(this.atLeast(now), () => this.replace(observed));
              continue;
            }
          }
        } else if (tx.phase === "candidate_activating" || tx.phase === "rollback_activating" || tx.phase === "aborting") {
          const candidate = tx.phase === "candidate_activating", aborting = tx.phase === "aborting";
          const image = candidate ? tx.candidate.image : state.stable.artifact.image;
          const boot = candidate ? tx.candidateBootId : aborting ? state.stable.bootId : tx.rollbackBootId;
          const operation = candidate ? tx.candidateBootId : aborting ? tx.drainId : tx.rollbackBootId;
          if (!this.owns(observed, image, boot) || observed.files.image !== image) throw new Stop("physical");
          if (this.idle(observed)) {
            const proof = await this.ports.host.journalProof(observed);
            if (candidate) { await this.journal.confirmCandidate(proof, this.atLeast(now)); outcome = "updated"; }
            else if (aborting) { await this.journal.confirmAbort(proof, this.atLeast(now)); outcome = "aborted"; }
            else { await this.journal.confirmRollback(proof, this.atLeast(now)); outcome = "rolled-back"; }
            continue;
          }
          const deadline = tx.healthDeadline ?? tx.phaseAt + 120_000;
          if (now >= deadline) await this.fail(aborting || candidate ? "activation_uncertain" : "rollback_failed");
          if (maintenance?.operationId && maintenance.operationId !== operation) throw new Stop("physical");
          if (maintenance?.phase === "failed") await this.fail("activation_uncertain");
          if (this.can("resume:" + operation)) {
            if (aborting && maintenance?.operationId === operation) {
              await this.journal.retryAbortResume(this.atLeast(now), () => this.control("resume", operation, observed));
              continue;
            }
            if (this.paused(observed, operation)) {
              await this.journal.retryResume(await this.ports.host.journalProof(observed), this.atLeast(now), () => this.control("resume", operation, observed));
              continue;
            }
          }
        }
        const before = this.now(); await this.sleep(2000); const after = this.now();
        stalled = after <= before ? stalled + 1 : 0;
        if (stalled >= 3) throw new Stop("clock");
      }
      throw new Stop("deadline");
    } catch (error) { return { status: "needs-human", reason: error instanceof Stop ? error.reason : "uncertain" }; }
  }
}

/** Fixed private files + actual Docker/HTTP/registry ports, no simulated defaults.
 * Bootstrap and a verified shared flock are mandatory BEFORE calling this. */
export async function loadWorkerUpdateDriver(registry: WorkerRegistry) {
  try {
    const files = new WorkerFiles("/opt/ir35-worker");
    const read = async () => updateJournalSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true })
      .decode(await files.read("update-state.json"))));
    let expected = await read();
    const journal = new WorkerUpdateJournal(expected, async next => {
      if (!same(await read(), expected)) throw new Error("Worker journal changed; reload durable state.");
      await files.writeOperational("update-state.json", JSON.stringify(next) + "\n");
      expected = structuredClone(next);
    });
    return new WorkerUpdateDriver(journal, { host: new WorkerHost("/opt/ir35-worker", { files }), registry });
  } catch { throw new Error("Worker update state could not be loaded safely; no private values emitted."); }
}
