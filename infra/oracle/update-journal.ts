import { z } from "zod";
import { digestSchema, imageSchema, shaSchema } from "./image-trust";

const epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 600_000);
export const updateArtifactSchema = z.strictObject({ image: imageSchema, digest: digestSchema, revision: shaSchema })
  .refine(value => value.image.endsWith(`@${value.digest}`));
const releaseSchema = z.strictObject({ artifact: updateArtifactSchema, bootId: z.uuid().nullable() });
const reasons = z.enum(["busy", "clock_skew", "launch_failed", "health_failed", "configuration_changed", "activation_uncertain", "rollback_failed"]);
const transactionSchema = z.strictObject({
  drainId: z.uuid(), candidateBootId: z.uuid(), rollbackBootId: z.uuid(), candidate: updateArtifactSchema,
  phase: z.enum(["draining", "candidate_starting", "candidate_activating", "aborting", "rollback_starting", "rollback_activating", "failed"]),
  startedAt: epoch, drainDeadline: epoch, phaseAt: epoch, healthDeadline: epoch.nullable(), reason: reasons.nullable(),
}).refine(value => {
  const timed = ["candidate_starting", "candidate_activating", "rollback_starting", "rollback_activating"].includes(value.phase);
  return new Set([value.drainId, value.candidateBootId, value.rollbackBootId]).size === 3
    && value.drainDeadline === value.startedAt + 600_000
    && (timed ? value.phaseAt >= value.startedAt && value.healthDeadline === value.phaseAt + 120_000 : value.healthDeadline === null)
    && (value.phase !== "draining" || value.phaseAt === value.startedAt)
    && (!["aborting", "rollback_starting", "rollback_activating", "failed"].includes(value.phase) || value.reason !== null);
});
export const updateJournalSchema = z.strictObject({ version: z.literal(1), revision: z.number().int().nonnegative(),
  mode: z.enum(["standby", "consumer"]), invariantsHash: z.string().regex(/^[a-f0-9]{64}$/),
  stable: releaseSchema, previous: releaseSchema.nullable(), rejectedDigest: digestSchema.nullable(), transaction: transactionSchema.nullable(),
}).refine(value => !value.transaction || (value.transaction.candidate.image !== value.stable.artifact.image
  && ![value.stable.bootId, value.previous?.bootId].some(id => id !== null && id !== undefined
    && [value.transaction!.drainId, value.transaction!.candidateBootId, value.transaction!.rollbackBootId].includes(id))));
export type UpdateJournalState = z.infer<typeof updateJournalSchema>;
export type UpdateArtifact = z.infer<typeof updateArtifactSchema>;

const proofSchema = z.strictObject({ observedAt: epoch, image: imageSchema, bootId: z.uuid().nullable(),
  invariantsHash: z.string().regex(/^[a-f0-9]{64}$/), mode: z.enum(["standby", "consumer"]),
  ok: z.literal(true), browserReady: z.literal(true), databaseReady: z.literal(true),
  active: z.number().int().nonnegative(), handlersActive: z.number().int().nonnegative(), submitting: z.number().int().nonnegative(),
  maintenance: z.strictObject({ phase: z.enum(["idle", "drained"]), operationId: z.uuid().nullable(), safeToReplace: z.boolean() }),
});
type Proof = z.infer<typeof proofSchema>;

/** Write-ahead decisions only. A Linux driver/flock/physical observation is still required. */
export class WorkerUpdateJournal {
  private state: UpdateJournalState;
  private uncertain = false;
  constructor(input: unknown, private readonly persist: (state: UpdateJournalState) => Promise<void>) {
    this.state = updateJournalSchema.parse(input);
  }
  snapshot(): UpdateJournalState {
    if (this.uncertain) throw new Error("Journal persistence is uncertain; reload durable state before further actions.");
    return structuredClone(this.state);
  }
  private async save(next: UpdateJournalState) {
    if (this.uncertain) throw new Error("Journal persistence is uncertain; reload durable state before further actions.");
    const parsed = updateJournalSchema.parse({ ...next, revision: this.state.revision + 1 });
    // A failed/unknown journal acknowledgement must stop before any mutation.
    // Caller reloads durable state; never silently retry using this stale object.
    try { await this.persist(structuredClone(parsed)); }
    catch { this.uncertain = true; throw new Error("Journal persistence is uncertain; reload durable state before further actions."); }
    this.state = parsed;
  }
  private async intent(next: UpdateJournalState, effect: () => Promise<void>) {
    await this.save(next);
    try { await effect(); return { acknowledged: true }; }
    catch { return { acknowledged: false }; } // unknown external result, never error text or blind replay
  }
  private requireTransaction(...phases: NonNullable<UpdateJournalState["transaction"]>["phase"][]) {
    const tx = this.state.transaction;
    if (!tx || !phases.includes(tx.phase)) throw new Error("Invalid worker update journal transition.");
    return tx;
  }
  private proof(input: unknown, now: number, image: string, bootId: string | null): Proof {
    epoch.parse(now); const proof = proofSchema.parse(input);
    if (proof.observedAt > now || now - proof.observedAt > 5000 || proof.image !== image || proof.bootId !== bootId
      || proof.invariantsHash !== this.state.invariantsHash || proof.mode !== this.state.mode)
      throw new Error("Fresh unchanged physical worker proof is required.");
    if (this.state.mode === "standby" && (proof.active !== 0 || proof.handlersActive !== 0 || proof.submitting !== 0))
      throw new Error("Standby must not report consuming work.");
    return proof;
  }
  private paused(input: unknown, now: number, image: string, bootId: string | null, operationId: string) {
    const proof = this.proof(input, now, image, bootId);
    if (proof.active !== 0 || proof.handlersActive !== 0 || proof.submitting !== 0 || proof.maintenance.phase !== "drained"
      || proof.maintenance.operationId !== operationId || !proof.maintenance.safeToReplace)
      throw new Error("Worker must be confirmed paused with no running work.");
  }
  private resumed(input: unknown, now: number, image: string, bootId: string | null) {
    const proof = this.proof(input, now, image, bootId);
    if (proof.maintenance.phase !== "idle" || proof.maintenance.operationId !== null || proof.maintenance.safeToReplace)
      throw new Error("Worker resume has not been confirmed.");
    // After a committed resume, legitimate applications may already be active.
  }

  async begin(input: unknown, effect: () => Promise<void>) {
    const parsed = z.strictObject({ candidate: updateArtifactSchema, drainId: z.uuid(), candidateBootId: z.uuid(), rollbackBootId: z.uuid(), now: epoch }).parse(input);
    if (this.state.transaction || parsed.candidate.image === this.state.stable.artifact.image || parsed.candidate.digest === this.state.rejectedDigest)
      throw new Error("Worker update is already active or this image is ineligible.");
    const { now, ...fields } = parsed;
    const tx = transactionSchema.parse({ ...fields, phase: "draining", startedAt: now,
      drainDeadline: now + 600_000, phaseAt: now, healthDeadline: null, reason: null });
    return this.intent({ ...this.state, transaction: tx }, effect);
  }
  async startCandidate(proof: unknown, now: number, effect: () => Promise<void>) {
    const tx = this.requireTransaction("draining"); epoch.parse(now);
    if (now < tx.startedAt || now >= tx.drainDeadline) throw new Error("Worker drain deadline expired; abort without replacement.");
    this.paused(proof, now, this.state.stable.artifact.image, this.state.stable.bootId, tx.drainId);
    return this.intent({ ...this.state, transaction: { ...tx, phase: "candidate_starting", phaseAt: now, healthDeadline: now + 120_000 } }, effect);
  }
  async activateCandidate(proof: unknown, now: number, effect: () => Promise<void>) {
    const tx = this.requireTransaction("candidate_starting"); epoch.parse(now);
    if (now < tx.phaseAt || now >= tx.healthDeadline!) throw new Error("Candidate health deadline expired; restore the previous image.");
    this.paused(proof, now, tx.candidate.image, tx.candidateBootId, tx.candidateBootId);
    // This durable decision MUST precede resume. Recovery must not roll back a
    // possibly resumed candidate and cancel/replay an unknown employer outcome.
    return this.intent({ ...this.state, transaction: { ...tx, phase: "candidate_activating", phaseAt: now, healthDeadline: now + 120_000 } }, effect);
  }
  async confirmCandidate(proof: unknown, now: number) {
    const tx = this.requireTransaction("candidate_activating");
    this.resumed(proof, now, tx.candidate.image, tx.candidateBootId);
    await this.save({ ...this.state, previous: this.state.stable,
      stable: { artifact: tx.candidate, bootId: tx.candidateBootId }, rejectedDigest: null, transaction: null });
  }
  async startRollback(now: number, reason: "launch_failed" | "health_failed", effect: () => Promise<void>) {
    const tx = this.requireTransaction("candidate_starting"); epoch.parse(now); z.enum(["launch_failed", "health_failed"]).parse(reason);
    if (now < tx.phaseAt) throw new Error("Clock moved backwards; physical reconciliation required.");
    // Driver must verify that the candidate has never resumed, owns its exact
    // boot generation, and that files still match before recreating anything.
    return this.intent({ ...this.state, transaction: { ...tx, phase: "rollback_starting", phaseAt: now,
      healthDeadline: now + 120_000, reason } }, effect);
  }
  async activateRollback(proof: unknown, now: number, effect: () => Promise<void>) {
    const tx = this.requireTransaction("rollback_starting"); epoch.parse(now);
    if (now < tx.phaseAt || now >= tx.healthDeadline!) throw new Error("Rollback health deadline expired; operator attention required.");
    this.paused(proof, now, this.state.stable.artifact.image, tx.rollbackBootId, tx.rollbackBootId);
    return this.intent({ ...this.state, transaction: { ...tx, phase: "rollback_activating", phaseAt: now, healthDeadline: now + 120_000 } }, effect);
  }
  async confirmRollback(proof: unknown, now: number) {
    const tx = this.requireTransaction("rollback_activating");
    this.resumed(proof, now, this.state.stable.artifact.image, tx.rollbackBootId);
    await this.save({ ...this.state, stable: { ...this.state.stable, bootId: tx.rollbackBootId },
      rejectedDigest: tx.candidate.digest, transaction: null });
  }
  async abort(now: number, reason: "busy" | "clock_skew", effect: () => Promise<void>) {
    const tx = this.requireTransaction("draining"); epoch.parse(now); z.enum(["busy", "clock_skew"]).parse(reason);
    // Resume of the existing worker only. No image/flag write, including when
    // the clock regresses. Unfinished stops arm resume safely in the worker.
    return this.intent({ ...this.state, transaction: { ...tx, phase: "aborting", phaseAt: now, healthDeadline: null, reason } }, effect);
  }
  async confirmAbort(proof: unknown, now: number) {
    this.requireTransaction("aborting"); this.resumed(proof, now, this.state.stable.artifact.image, this.state.stable.bootId);
    await this.save({ ...this.state, transaction: null });
  }
  async retryDrain(proof: unknown, now: number, effect: () => Promise<void>) {
    const tx = this.requireTransaction("draining");
    const sample = this.proof(proof, now, this.state.stable.artifact.image, this.state.stable.bootId);
    if (now < tx.startedAt || now >= tx.drainDeadline || sample.maintenance.phase !== "idle" || sample.maintenance.operationId !== null)
      throw new Error("Drain replay is not safe or its original deadline expired.");
    return this.intent(this.state, effect); // same UUID and deadline; authenticated worker command is idempotent
  }
  async retryResume(proof: unknown, now: number, effect: () => Promise<void>) {
    const tx = this.requireTransaction("aborting", "candidate_activating", "rollback_activating");
    if (tx.healthDeadline !== null && (now < tx.phaseAt || now >= tx.healthDeadline)) throw new Error("Resume acknowledgement is uncertain; physical reconciliation required.");
    const candidate = tx.phase === "candidate_activating";
    const image = candidate ? tx.candidate.image : this.state.stable.artifact.image;
    const boot = candidate ? tx.candidateBootId : tx.phase === "rollback_activating" ? tx.rollbackBootId : this.state.stable.bootId;
    const operation = candidate ? tx.candidateBootId : tx.phase === "rollback_activating" ? tx.rollbackBootId : tx.drainId;
    this.paused(proof, now, image, boot, operation);
    return this.intent(this.state, effect); // never re-register with a different operation or reset a deadline
  }
  async recoverStableBoot(proof: unknown, now: number, effect: () => Promise<void>) {
    if (this.state.transaction || !this.state.stable.bootId) throw new Error("No committed boot generation to recover.");
    this.paused(proof, now, this.state.stable.artifact.image, this.state.stable.bootId, this.state.stable.bootId);
    return this.intent(this.state, effect); // already committed release; no replacement or cutover change
  }
  async fail(reason: unknown, now: number) {
    const tx = this.state.transaction; if (!tx) throw new Error("No active worker update.");
    epoch.parse(now);
    await this.save({ ...this.state, transaction: { ...tx, phase: "failed", phaseAt: now, healthDeadline: null, reason: reasons.parse(reason) } });
  }
}
