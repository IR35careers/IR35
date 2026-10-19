import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { imageSchema } from "./image-trust";

// Canonical JSON hash of the reviewed loopback-only Compose policy. A regression
// binds this pin to the source file; changes require explicit policy review.
export const COMPOSE_POLICY_HASH = "d901c1e70ccab1de3df07dae484aa16abc8644ab64a1faffdbd0840974dca32a";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const snapshotSchema = z.strictObject({ image: imageSchema, mode: z.enum(["standby", "consumer"]),
  runner: z.enum(["vercel", "oracle", "railway"]), accepting: z.boolean(), invariantsHash: hashSchema, deployHash: hashSchema });
export type WorkerFileSnapshot = z.infer<typeof snapshotSchema>;
const deploymentSchema = z.strictObject({ IR35_WORKER_IMAGE: imageSchema,
  APPLY_RUNNER: z.enum(["vercel", "oracle", "railway"]), APPLICATION_WORKER_ACCEPT_JOBS: z.enum(["false", "true"]),
}).refine(value => value.APPLICATION_WORKER_ACCEPT_JOBS !== "true" || value.APPLY_RUNNER !== "vercel");
const utf8 = (bytes: Buffer) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

export function readWorkerDeployment(input: unknown) {
  try {
    const text = z.string().max(16_384).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)).parse(input);
    const fields: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const pair = /^(IR35_WORKER_IMAGE|APPLY_RUNNER|APPLICATION_WORKER_ACCEPT_JOBS)=([^\r\n]+)$/.exec(line);
      if (!pair || Object.hasOwn(fields, pair[1])) throw new Error();
      fields[pair[1]] = pair[2];
    }
    return deploymentSchema.parse(fields);
  } catch { throw new Error("Invalid worker deployment configuration; no values emitted."); }
}

export function replaceWorkerImage(input: unknown, image: unknown) {
  const text = z.string().parse(input); readWorkerDeployment(text);
  return text.replace(/^IR35_WORKER_IMAGE=[^\r\n]*/m, `IR35_WORKER_IMAGE=${imageSchema.parse(image)}`);
}

export function workerUpdateOverride(operationId: unknown) {
  const id = z.uuid().parse(operationId);
  return JSON.stringify({ services: { worker: { environment: { APPLICATION_WORKER_UPDATE_OPERATION: id },
    labels: { "com.ir35careers.update-operation": id } } } }, null, 2) + "\n";
}

/** A recovery file cannot smuggle acceptance, mounts, ports or arbitrary env. */
export function readWorkerUpdateOverride(input: unknown) {
  try {
    const value: unknown = JSON.parse(z.string().max(4096).parse(input));
    const parsed = z.strictObject({ services: z.strictObject({ worker: z.strictObject({
      environment: z.strictObject({ APPLICATION_WORKER_UPDATE_OPERATION: z.uuid() }),
      labels: z.strictObject({ "com.ir35careers.update-operation": z.uuid() }),
    }) }) }).parse(value);
    const worker = parsed.services.worker;
    if (worker.environment.APPLICATION_WORKER_UPDATE_OPERATION !== worker.labels["com.ir35careers.update-operation"]) throw new Error();
    return worker.environment.APPLICATION_WORKER_UPDATE_OPERATION;
  } catch { throw new Error("Invalid worker update override; no values emitted."); }
}

/** No shell evaluation, quote removal, variable expansion or private error data. */
export function readMaintenanceSecret(input: unknown) {
  try {
    const text = z.string().max(131_072).refine(value => !value.includes("\0")).parse(input);
    const values: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const pair = /^([A-Z][A-Z0-9_]*)=([^\r\n]*)$/.exec(line);
      if (!pair || Object.hasOwn(values, pair[1]) || ["APPLICATION_WORKER_UPDATE_OPERATION", "GHCR_TOKEN", "GITHUB_TOKEN", "SSH_PRIVATE_KEY", "OCI_CLI_KEY_CONTENT"].includes(pair[1])) throw new Error();
      values[pair[1]] = pair[2];
    }
    return z.string().trim().min(32).max(1024).parse(values.APPLICATION_WORKER_SECRET);
  } catch { throw new Error("Worker maintenance credential is unavailable; no values emitted."); }
}

type FileName = ".env" | "deploy.env" | "docker-compose.yml" | "update-state.json" | "update-override.json" | "ghcr.token";
const files = z.enum([".env", "deploy.env", "docker-compose.yml", "update-state.json", "update-override.json", "ghcr.token"]);

/** Linux host only. Caller must hold the shared updater/operator flock. */
export class WorkerFiles {
  private readonly directory: string;
  constructor(directory: string) {
    if (process.platform !== "linux" || !process.getuid) throw new Error("Worker host file operations require Linux.");
    if (!isAbsolute(directory) || resolve(directory) !== directory || directory === "/") throw new Error("Invalid worker file directory.");
    this.directory = directory;
  }
  private async checkDirectory() {
    const value = await lstat(this.directory);
    if (!value.isDirectory() || value.isSymbolicLink() || value.uid !== process.getuid!() || (value.mode & 0o027) !== 0)
      throw new Error("Unsafe worker file directory.");
  }
  private file(name: FileName) { return join(this.directory, files.parse(name)); }
  async read(name: FileName, limit = 131_072): Promise<Buffer> {
    try {
      await this.checkDirectory(); z.number().int().min(1).max(262_144).parse(limit);
      const handle = await open(this.file(name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.uid !== process.getuid!() || (before.mode & 0o777) !== 0o600 || before.nlink !== 1 || before.size > limit) throw new Error();
        const bytes = Buffer.alloc(limit + 1); let size = 0;
        while (size < bytes.length) {
          const result = await handle.read(bytes, size, bytes.length - size, size);
          if (result.bytesRead === 0) break; size += result.bytesRead;
        }
        const after = await handle.stat();
        if (size > limit || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error();
        return bytes.subarray(0, size);
      } finally { await handle.close(); }
    } catch { throw new Error("Worker private file could not be read safely; no values emitted."); }
  }
  async snapshot(): Promise<WorkerFileSnapshot> {
    try {
      const [deployment, environment, compose] = await Promise.all([this.read("deploy.env", 16_384), this.read(".env"), this.read("docker-compose.yml", 16_384)]);
      const text = utf8(deployment); const config = readWorkerDeployment(text);
      readMaintenanceSecret(utf8(environment)); // persistent startup override/ambiguous key is forbidden
      const policy: unknown = JSON.parse(utf8(compose));
      z.object({ name: z.literal("ir35-worker"), services: z.object({ worker: z.unknown() }).strict() }).strict().parse(policy);
      if (hash(JSON.stringify(policy)) !== COMPOSE_POLICY_HASH) throw new Error();
      return snapshotSchema.parse({ image: config.IR35_WORKER_IMAGE,
        mode: config.APPLICATION_WORKER_ACCEPT_JOBS === "true" ? "consumer" : "standby",
        runner: config.APPLY_RUNNER, accepting: config.APPLICATION_WORKER_ACCEPT_JOBS === "true",
        invariantsHash: hash(JSON.stringify([hash(environment), hash(compose), hash(text.replace(/^IR35_WORKER_IMAGE=[^\r\n]*/m, "IR35_WORKER_IMAGE=<image>"))])),
        deployHash: hash(deployment),
      });
    } catch { throw new Error("Worker configuration snapshot failed; no values emitted."); }
  }
  async maintenanceSecret() { return readMaintenanceSecret(utf8(await this.read(".env"))); }

  async replaceImage(expected: unknown, image: unknown): Promise<WorkerFileSnapshot> {
    const snapshot = snapshotSchema.parse(expected); const target = imageSchema.parse(image);
    const current = await this.snapshot();
    if (JSON.stringify(current) !== JSON.stringify(snapshot)) throw new Error("Worker configuration changed; update refused.");
    const original = utf8(await this.read("deploy.env", 16_384));
    if (hash(original) !== snapshot.deployHash) throw new Error("Worker configuration changed; update refused.");
    const updated = replaceWorkerImage(original, target);
    await this.atomicWrite("deploy.env", updated, async () => {
      const latest = await this.snapshot();
      if (JSON.stringify(latest) !== JSON.stringify(snapshot)) throw new Error("Worker configuration changed; update refused.");
    });
    const result = await this.snapshot();
    if (result.image !== target || result.invariantsHash !== snapshot.invariantsHash) throw new Error("Worker update requires reconciliation.");
    return result;
  }

  /** State/override are private operational files, never the worker secret file. */
  async writeOperational(name: "update-state.json" | "update-override.json", input: unknown) {
    z.enum(["update-state.json", "update-override.json"]).parse(name);
    const text = z.string().max(131_072).parse(input);
    const value: unknown = JSON.parse(text); z.object({}).passthrough().parse(value);
    if (name === "update-override.json") readWorkerUpdateOverride(text);
    await this.atomicWrite(name, text);
  }
  private async atomicWrite(name: "deploy.env" | "update-state.json" | "update-override.json", text: string, beforeRename?: () => Promise<void>) {
    await this.checkDirectory(); const temporary = join(this.directory, `.update-${randomUUID()}.tmp`); let replaced = false;
    try {
      // Refuse unsafe pre-existing targets rather than replacing links/other owners.
      try { const target = await lstat(this.file(name));
        if (!target.isFile() || target.isSymbolicLink() || target.uid !== process.getuid!() || (target.mode & 0o777) !== 0o600 || target.nlink !== 1) throw new Error();
      } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw new Error(); }
      const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await handle.chmod(0o600); await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
      await beforeRename?.(); await this.checkDirectory();
      await rename(temporary, this.file(name)); replaced = true;
      const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw new Error("Worker file update failed; reconcile the saved operation before retrying."); }
    finally { if (!replaced) { try { await unlink(temporary); } catch { /* Only this unique temporary file, never broad cleanup. */ } } }
  }
}
