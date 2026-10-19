import { z } from "zod";
import { posix } from "node:path";
import { hostCommand, dockerEnvironment } from "./host-command";
import { cosignVerifyArgs, imageSchema, readVerifiedImage, shaSchema } from "./image-trust";
import { updateJournalSchema, type UpdateArtifact } from "./update-journal";
import { WorkerFiles, workerUpdateOverride, type WorkerFileSnapshot } from "./worker-files";
import { signMaintenanceBody } from "../../services/application-worker/maintenance";

const id = z.string().regex(/^[a-f0-9]{64}$/);
const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const optionalBoot = z.union([z.uuid(), z.literal(""), z.null()]).transform(value => value || null);
const binding = z.strictObject({ HostIp: z.literal("127.0.0.1"), HostPort: z.literal("8787") });
const identitySchema = z.strictObject({ id, imageId, image: imageSchema,
  status: z.enum(["created", "running", "paused", "restarting", "removing", "exited", "dead"]), running: z.boolean(),
  project: z.literal("ir35-worker"), service: z.literal("worker"), bootId: optionalBoot,
  ports: z.array(binding).max(1).nullable().transform(value => value ?? []),
}).refine(value => !value.running || (value.status === "running" && value.ports.length === 1));
export type HostWorkerIdentity = z.infer<typeof identitySchema>;
const maintenanceSchema = z.strictObject({ phase: z.enum(["idle", "draining", "drained", "resuming", "failed"]),
  operationId: z.uuid().nullable(), safeToReplace: z.boolean() });
const healthSchema = z.object({ ok: z.boolean(), service: z.literal("ir35-queue-worker"), mode: z.enum(["standby", "consumer"]),
  active: z.number().int().nonnegative(), handlersActive: z.number().int().nonnegative(), submitting: z.number().int().nonnegative().nullable(),
  browserReady: z.boolean(), databaseReady: z.boolean(), maintenance: maintenanceSchema.nullable(),
});
export type HostWorkerHealth = z.infer<typeof healthSchema>;
export type HostWorkerObservation = { identity: HostWorkerIdentity | null; files: WorkerFileSnapshot; health: HostWorkerHealth | null; observedAt: number };

// Deliberately select ONLY non-secret fields. Never request .Config.Env, raw
// container inspection, Compose config output, or the raw worker environment.
export const WORKER_INSPECT_TEMPLATE = '{"id":{{json .Id}},"imageId":{{json .Image}},"image":{{json .Config.Image}},"status":{{json .State.Status}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"bootId":{{json (index .Config.Labels "com.ir35careers.update-operation")}},"ports":{{json (index .NetworkSettings.Ports "8787/tcp")}}}';
export const WORKER_IMAGE_TEMPLATE = '{"id":{{json .Id}},"architecture":{{json .Architecture}},"os":{{json .Os}},"digests":{{json .RepoDigests}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}';
export const LOCAL_DOCKER_SOCKET = ["--host", "unix:///var/run/docker.sock"] as const;
type Command = typeof hostCommand;
type Http = (url: string, init: RequestInit) => Promise<Response>;
type Files = Pick<WorkerFiles, "snapshot" | "maintenanceSecret" | "replaceImage" | "writeOperational">;

async function boundedResponse(response: Response) {
  if (!response.body) throw new Error();
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 32_768) { await reader.cancel(); throw new Error(); }
      parts.push(part.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
  } finally { reader.releaseLock(); }
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Actual local Docker/HTTP boundary. Caller holds flock and serialises the journal. */
export class WorkerHost {
  private readonly files: Files;
  private readonly command: Command;
  private readonly http: Http;
  private readonly clock: () => number;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly verified = new Map<string, { artifact: UpdateArtifact; imageId: string }>();
  constructor(private readonly directory: string, ports: { files?: Files; command?: Command; http?: Http; now?: () => number; env?: NodeJS.ProcessEnv } = {}) {
    if (directory !== "/opt/ir35-worker") throw new Error("Worker host requires the reviewed fixed deployment directory.");
    this.files = ports.files ?? new WorkerFiles(directory);
    this.command = ports.command ?? hostCommand; this.http = ports.http ?? fetch; this.clock = ports.now ?? Date.now;
    this.environment = dockerEnvironment(ports.env ?? process.env);
  }
  private async docker(args: readonly string[], timeoutMs = 15_000) {
    // Explicit CLI host wins over a saved remote currentContext as well as the
    // ambient override variables already removed by dockerEnvironment.
    return this.command("docker", [...LOCAL_DOCKER_SOCKET, ...args], { env: this.environment, timeoutMs });
  }
  private now() {
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid worker host clock.");
    return now;
  }
  private async identity(): Promise<HostWorkerIdentity | null> {
    const stdout = await this.docker(["ps", "--all", "--no-trunc", "--filter", "label=com.docker.compose.project=ir35-worker",
      "--filter", "label=com.docker.compose.service=worker", "--format", "{{.ID}}"]);
    const values = stdout.trim() ? stdout.trim().split(/\r?\n/) : [];
    if (values.length === 0) return null;
    if (values.length !== 1) throw new Error();
    const container = id.parse(values[0]);
    const result = identitySchema.parse(JSON.parse(await this.docker(["container", "inspect", "--format", WORKER_INSPECT_TEMPLATE, container])));
    if (result.id !== container) throw new Error();
    return result;
  }
  private async health(): Promise<HostWorkerHealth | null> {
    try {
      const response = await this.http("http://127.0.0.1:8787/health", { method: "GET", redirect: "error", signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (response.status !== 200 && response.status !== 503) return null;
      const parsed = healthSchema.parse(await boundedResponse(response));
      if (parsed.ok !== (response.status === 200)) return null;
      return parsed;
    } catch { return null; } // no raw response/transport error disclosure
  }
  async observe(): Promise<HostWorkerObservation> {
    try {
      const files = await this.files.snapshot(); const before = await this.identity();
      const health = before?.running ? await this.health() : null;
      const observedAt = this.now();
      // A health response from a removed generation must never authorise its replacement.
      const after = await this.identity(); const latest = await this.files.snapshot();
      const finishedAt = this.now();
      if (!Number.isSafeInteger(observedAt) || !Number.isSafeInteger(finishedAt) || finishedAt < observedAt || finishedAt - observedAt > 5000
        || !same(before, after) || !same(files, latest) || (health && health.mode !== files.mode)) throw new Error();
      return { files, identity: after, health, observedAt };
    } catch { throw new Error("Worker physical observation failed; no private diagnostics emitted."); }
  }
  private async unchanged(observed: HostWorkerObservation) {
    const now = this.now();
    if (!Number.isSafeInteger(observed.observedAt) || observed.observedAt > now || now - observed.observedAt > 5000
      || !same(await this.files.snapshot(), observed.files) || !same(await this.identity(), observed.identity)) throw new Error();
    const finished = this.now();
    if (finished < now || finished - observed.observedAt > 5000) throw new Error();
  }
  async control(action: "drain" | "resume", operation: unknown, observed: HostWorkerObservation) {
    try {
      z.enum(["drain", "resume"]).parse(action); const operationId = z.uuid().parse(operation);
      await this.unchanged(observed);
      if (!observed.identity?.running || observed.identity.image !== observed.files.image) throw new Error();
      const secret = await this.files.maintenanceSecret();
      await this.unchanged(observed); // a delayed private-file read cannot refresh authority
      const body = JSON.stringify({ action, operationId }); const timestamp = String(this.now());
      const response = await this.http("http://127.0.0.1:8787/maintenance", { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json", "x-ir35-maintenance-timestamp": timestamp,
          "x-ir35-maintenance-signature": signMaintenanceBody(secret, body, timestamp) }, body });
      if (response.status !== 202) throw new Error();
      // Acknowledgement is not proof that drain/resume finished. Re-observe later.
      z.strictObject({ maintenance: maintenanceSchema }).parse(await boundedResponse(response));
    } catch { throw new Error("Worker maintenance acknowledgement is uncertain; reconcile the saved operation."); }
  }
  async verifyAndPull(image: unknown, immutable: (revision: string, digest: string) => Promise<string>): Promise<UpdateArtifact> {
    try {
      const target = imageSchema.parse(image);
      // A failed repeat verification must not retain an earlier authorisation.
      this.verified.delete(target);
      const signature = await this.command("cosign", cosignVerifyArgs(target), { env: this.environment, timeoutMs: 60_000 });
      const artifact = readVerifiedImage(target, signature);
      if (await immutable(artifact.revision, artifact.digest) !== target) throw new Error();
      await this.docker(["pull", "--platform", "linux/arm64", target], 120_000);
      const local = z.strictObject({ id: imageId, architecture: z.literal("arm64"), os: z.literal("linux"),
        digests: z.array(imageSchema).min(1).max(32), revision: shaSchema,
      }).parse(JSON.parse(await this.docker(["image", "inspect", "--format", WORKER_IMAGE_TEMPLATE, target])));
      if (!local.digests.includes(target) || local.revision !== artifact.revision) throw new Error();
      this.verified.set(target, { artifact, imageId: local.id });
      return artifact;
    } catch { throw new Error("Worker image verification or pull failed; no deployment selection changed."); }
  }
  async journalProof(observed: HostWorkerObservation) {
    await this.unchanged(observed);
    const { identity, health, files, observedAt } = observed;
    if (!identity?.running || identity.image !== files.image || !health?.ok || !health.databaseReady || !health.browserReady
      || health.submitting === null || !health.maintenance || !["idle", "drained"].includes(health.maintenance.phase))
      throw new Error("Worker is not a healthy journal observation.");
    return { observedAt, image: identity.image, bootId: identity.bootId, invariantsHash: files.invariantsHash, mode: health.mode,
      ok: true, browserReady: true, databaseReady: true, active: health.active, handlersActive: health.handlersActive,
      submitting: health.submitting, maintenance: health.maintenance };
  }
  /** One effect per persisted intent; NEVER blindly repeat after a lost Compose ack. */
  async replace(input: unknown, observed: HostWorkerObservation) {
    try {
      const state = updateJournalSchema.parse(input); const tx = state.transaction;
      if (!tx || !["candidate_starting", "rollback_starting"].includes(tx.phase)
        || state.invariantsHash !== observed.files.invariantsHash || state.mode !== observed.files.mode
        || this.now() < tx.phaseAt || this.now() >= tx.healthDeadline!) throw new Error();
      await this.unchanged(observed);
      const container = observed.identity;
      const candidate = tx.phase === "candidate_starting";
      if (candidate) {
        if (!container || container.image !== state.stable.artifact.image || container.bootId !== state.stable.bootId
          || observed.files.image !== container.image || !observed.health?.ok || !observed.health.databaseReady || !observed.health.browserReady
          || observed.health.maintenance?.phase !== "drained" || observed.health.maintenance.operationId !== tx.drainId
          || !observed.health.maintenance.safeToReplace || observed.health.active !== 0
          || observed.health.handlersActive !== 0 || observed.health.submitting !== 0) throw new Error();
      } else {
        // Only a generation that has NEVER had a durable resume decision may be
        // restored this way. Positively empty Docker inventory can mean failed
        // creation; a foreign/ambiguous generation is never a removal target.
        const sample = observed.health;
        if ((container && (container.image !== tx.candidate.image || container.bootId !== tx.candidateBootId)) || observed.files.image !== tx.candidate.image) throw new Error();
        if (sample && (sample.active !== 0 || sample.handlersActive !== 0 || (sample.submitting !== null && sample.submitting !== 0)
          || (sample.maintenance ? sample.maintenance.phase !== "drained" || sample.maintenance.operationId !== tx.candidateBootId : sample.ok))) throw new Error();
        // An unavailable startup DB is NOT a healthy proof. It can still be safe
        // to remove this exact owned boot-paused, never-resumed generation.
        // Rollback itself boots paused and needs full fresh DB/browser readiness.
      }
      const target = candidate ? tx.candidate : state.stable.artifact;
      const boot = candidate ? tx.candidateBootId : tx.rollbackBootId;
      const verified = this.verified.get(target.image);
      const sourceArtifact = candidate ? state.stable.artifact : tx.candidate;
      const source = this.verified.get(sourceArtifact.image);
      if (!verified || !same(verified.artifact, target) || !source || !same(source.artifact, sourceArtifact)
        || (container && source.imageId !== container.imageId)) throw new Error();
      // Recheck local bytes after the signature gate; mutable/local tags never run.
      const local = z.object({ id: imageId, architecture: z.literal("arm64"), os: z.literal("linux"), digests: z.array(imageSchema), revision: shaSchema })
        .parse(JSON.parse(await this.docker(["image", "inspect", "--format", WORKER_IMAGE_TEMPLATE, target.image])));
      if (!local.digests.includes(target.image) || local.revision !== target.revision || local.id !== verified.imageId) throw new Error();
      await this.unchanged(observed);
      await this.files.writeOperational("update-override.json", workerUpdateOverride(boot));
      const selected = await this.files.replaceImage(observed.files, target.image);
      if (selected.invariantsHash !== state.invariantsHash || selected.mode !== state.mode) throw new Error();
      if (!same(await this.files.snapshot(), selected) || !same(await this.identity(), observed.identity)
        || this.now() < tx.phaseAt || this.now() >= tx.healthDeadline!) throw new Error();
      await this.docker(["compose", "--project-directory", this.directory, "--env-file", posix.join(this.directory, "deploy.env"),
        "--file", posix.join(this.directory, "docker-compose.yml"), "--file", posix.join(this.directory, "update-override.json"),
        "up", "--detach", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", "worker"], 120_000);
    } catch { throw new Error("Worker replacement acknowledgement is uncertain; reconcile Docker and the durable journal before another action."); }
  }
}
