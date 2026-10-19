import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, link, mkdtemp, readdir, rmdir, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { COMPOSE_POLICY_HASH, readMaintenanceSecret, readWorkerDeployment, readWorkerUpdateOverride, replaceWorkerImage, WorkerFiles, workerUpdateOverride } from "../../infra/oracle/worker-files";
import { WORKER_IMAGE } from "../../infra/oracle/image-trust";

const oldImage = `${WORKER_IMAGE}@sha256:${"a".repeat(64)}`; const newImage = `${WORKER_IMAGE}@sha256:${"b".repeat(64)}`;
const deployment = `# controlled deployment\r\nIR35_WORKER_IMAGE=${oldImage}\r\nAPPLY_RUNNER=vercel\r\nAPPLICATION_WORKER_ACCEPT_JOBS=false\r\n`;
const secret = "'controlled-literal-$dollar-and-quotes-only'";
const environment = `APPLICATION_WORKER_SECRET=${secret}\nPG_BOSS_DATABASE_URL=controlled-$not-a-real-credential\n`;
const compose = readFileSync("infra/oracle/docker-compose.yml", "utf8");
const operationId = "00000000-0000-4000-8000-000000000001";

describe("literal file configuration and image-only replacement", () => {
  it("preserves all non-image bytes, including both cutover settings and CRLF", () => {
    expect(readWorkerDeployment(deployment)).toEqual({ IR35_WORKER_IMAGE: oldImage, APPLY_RUNNER: "vercel", APPLICATION_WORKER_ACCEPT_JOBS: "false" });
    expect(replaceWorkerImage(deployment, newImage)).toBe(deployment.replace(oldImage, newImage));
    const consumer = deployment.replace("APPLY_RUNNER=vercel", "APPLY_RUNNER=oracle").replace("APPLICATION_WORKER_ACCEPT_JOBS=false", "APPLICATION_WORKER_ACCEPT_JOBS=true");
    expect(replaceWorkerImage(consumer, newImage)).toBe(consumer.replace(oldImage, newImage)); // data only; no environment/consumer changed
  });
  it.each([
    deployment + "APPLY_RUNNER=oracle\n", deployment + "COMPOSE_FILE=attacker\n", deployment.replace("false", "true"),
    deployment.replace(oldImage, `${WORKER_IMAGE}:main`), deployment.replace(oldImage, `sha256:${"a".repeat(64)}`),
    deployment.replace("APPLY_RUNNER=vercel", "export APPLY_RUNNER=vercel"), deployment.replace("false", "'false'"),
    deployment.replace("false", "${OWNER_FLAG}"), deployment + "\0",
  ])("refuses ambiguous, mutable, shell-style and unsafe deployment input", value => {
    expect(() => readWorkerDeployment(value)).toThrow("no values emitted");
  });
  it("never sources, expands variables or strips the raw credential's literal quotes", () => {
    expect(readMaintenanceSecret(environment)).toBe(secret);
    for (const value of [environment + `APPLICATION_WORKER_SECRET=${secret}\n`, "APPLICATION_WORKER_SECRET=short\n",
      environment + "APPLICATION_WORKER_UPDATE_OPERATION=\n", environment + " APPLICATION_WORKER_UPDATE_OPERATION=\n",
      environment + ` APPLICATION_WORKER_SECRET=${secret}\n`, environment + "GHCR_TOKEN=must-stay-outside-container\n",
      environment + "GITHUB_TOKEN=must-stay-outside-container\n", environment + "\0"]) expect(() => readMaintenanceSecret(value)).toThrow("no values emitted");
  });
  it("binds the Compose policy to the reviewed loopback-only source", () => {
    expect(createHash("sha256").update(JSON.stringify(JSON.parse(compose))).digest("hex")).toBe(COMPOSE_POLICY_HASH);
    const policy = JSON.parse(compose); expect(policy.services.worker.ports).toEqual(["127.0.0.1:8787:8787"]);
    expect(policy.services.worker.env_file).toEqual([{ path: "/opt/ir35-worker/.env", format: "raw", required: true }]);
  });
  it("the temporary override contains only startup pause and a non-secret operation label, never cutover settings", () => {
    expect(JSON.parse(workerUpdateOverride(operationId))).toEqual({ services: { worker: {
      environment: { APPLICATION_WORKER_UPDATE_OPERATION: operationId }, labels: { "com.ir35careers.update-operation": operationId },
    } } });
    expect(workerUpdateOverride(operationId)).not.toContain("APPLICATION_WORKER_ACCEPT_JOBS");
    expect(workerUpdateOverride(operationId)).not.toContain("APPLY_RUNNER");
    expect(() => workerUpdateOverride("bad-id\nAPPLY_RUNNER=oracle")).toThrow();
    expect(readWorkerUpdateOverride(workerUpdateOverride(operationId))).toBe(operationId);
    const altered = JSON.parse(workerUpdateOverride(operationId));
    altered.services.worker.environment.APPLICATION_WORKER_ACCEPT_JOBS = "true";
    expect(() => readWorkerUpdateOverride(JSON.stringify(altered))).toThrow("no values emitted");
    delete altered.services.worker.environment.APPLICATION_WORKER_ACCEPT_JOBS;
    altered.services.worker.labels["com.ir35careers.update-operation"] = "00000000-0000-4000-8000-000000000002";
    expect(() => readWorkerUpdateOverride(JSON.stringify(altered))).toThrow("no values emitted");
  });
});

async function withPrivateFixture(test: (files: WorkerFiles, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "ir35-worker-files-"));
  try {
    await chmod(directory, 0o700);
    for (const [name, text] of [[".env", environment], ["deploy.env", deployment], ["docker-compose.yml", compose]])
      await writeFile(join(directory, name), text, { mode: 0o600, flag: "wx" });
    await test(new WorkerFiles(directory), directory);
  } finally {
    // Non-recursive cleanup of only this created fixture, never a workspace/home.
    if (resolve(directory).startsWith(resolve(tmpdir()) + "/ir35-worker-files-")) {
      const allowed = new Set([".env", "deploy.env", "docker-compose.yml", "update-state.json", "update-override.json", "extra", "target"]);
      for (const name of await readdir(directory)) { if (!allowed.has(name)) throw new Error("Unexpected fixture artifact retained for inspection."); await unlink(join(directory, name)); }
      await rmdir(directory);
    } else throw new Error("Unexpected fixture cleanup path; nothing removed.");
  }
}

describe("actual Linux host private-file boundary", () => {
  it("on Linux detects an owner edit immediately before rename and removes only its own temporary file", async () => {
    if (process.platform !== "linux") { expect(() => new WorkerFiles(resolve(tmpdir()))).toThrow("require Linux"); return; }
    await withPrivateFixture(async (files, directory) => {
      const before = await files.snapshot(); const original = files.snapshot.bind(files); let reads = 0;
      const spy = vi.spyOn(files, "snapshot").mockImplementation(async () => {
        if (++reads === 2) await writeFile(join(directory, ".env"), environment + "OWNER_CHANGE=preserve-this\n");
        return original();
      });
      try { await expect(files.replaceImage(before, newImage)).rejects.toThrow("reconcile the saved operation"); }
      finally { spy.mockRestore(); }
      expect((await files.read("deploy.env")).toString()).toBe(deployment);
      expect((await files.read(".env")).toString()).toContain("OWNER_CHANGE=preserve-this");
      expect((await readdir(directory)).filter(name => name.startsWith(".update-"))).toHaveLength(0);
    });
  });
  it("requires Linux instead of treating Windows chmod as POSIX secret protection", async () => {
    if (process.platform !== "linux") expect(() => new WorkerFiles(resolve(tmpdir()))).toThrow("require Linux");
    else {
      expect(() => new WorkerFiles("/")).toThrow("Invalid worker file directory");
      expect(() => new WorkerFiles("relative")).toThrow("Invalid worker file directory");
      await withPrivateFixture(async (files, directory) => {
        const before = await files.snapshot(); const updated = await files.replaceImage(before, newImage);
        expect(updated).toMatchObject({ image: newImage, mode: "standby", runner: "vercel", accepting: false, invariantsHash: before.invariantsHash });
        expect((await files.read("deploy.env")).toString()).toBe(deployment.replace(oldImage, newImage));
        expect((await files.read(".env")).toString()).toBe(environment); expect(await files.maintenanceSecret()).toBe(secret);
        expect((await stat(join(directory, "deploy.env"))).mode & 0o777).toBe(0o600);
        await files.writeOperational("update-state.json", JSON.stringify({ fixture: true }));
        await files.writeOperational("update-override.json", workerUpdateOverride(operationId));
        expect((await stat(join(directory, "update-state.json"))).mode & 0o777).toBe(0o600);
        expect(JSON.parse((await files.read("update-state.json")).toString())).toEqual({ fixture: true });
        await expect(files.replaceImage(before, oldImage)).rejects.toThrow("configuration changed");
      });
    }
  });
  it("on Linux refuses mode drift, symlinks, hardlinks, changed secret/config and non-reviewed Compose", async () => {
    if (process.platform !== "linux") { expect(() => new WorkerFiles(resolve(tmpdir()))).toThrow("require Linux"); return; }
    await withPrivateFixture(async (files, directory) => {
      const before = await files.snapshot();
      await chmod(join(directory, ".env"), 0o644); await expect(files.snapshot()).rejects.toThrow("no values emitted");
      await chmod(join(directory, ".env"), 0o600);
      await link(join(directory, ".env"), join(directory, "extra")); await expect(files.read(".env")).rejects.toThrow("no values emitted"); await unlink(join(directory, "extra"));
      await unlink(join(directory, ".env")); await writeFile(join(directory, "target"), environment, { mode: 0o600 });
      await symlink(join(directory, "target"), join(directory, ".env")); await expect(files.read(".env")).rejects.toThrow("no values emitted");
      await unlink(join(directory, ".env")); await writeFile(join(directory, ".env"), environment + "CHANGED=literal\n", { mode: 0o600 });
      await expect(files.replaceImage(before, newImage)).rejects.toThrow("configuration changed");
      await writeFile(join(directory, ".env"), environment);
      await writeFile(join(directory, "docker-compose.yml"), compose.replace("127.0.0.1:8787:8787", "0.0.0.0:8787:8787"));
      await expect(files.snapshot()).rejects.toThrow("no values emitted");
      await writeFile(join(directory, "docker-compose.yml"), compose);
      await expect(files.read(".env", 1)).rejects.toThrow("no values emitted");
      await chmod(directory, 0o770); await expect(files.snapshot()).rejects.toThrow("no values emitted"); await chmod(directory, 0o700);
    });
  });
});
