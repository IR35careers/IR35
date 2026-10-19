import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { WorkerHost, LOCAL_DOCKER_SOCKET, WORKER_IMAGE_TEMPLATE, WORKER_INSPECT_TEMPLATE, type HostWorkerIdentity, type HostWorkerHealth } from "../../infra/oracle/worker-host";
import { WORKER_IMAGE, cosignVerifyArgs } from "../../infra/oracle/image-trust";
import { WorkerUpdateJournal, type UpdateJournalState } from "../../infra/oracle/update-journal";
import { handleMaintenanceHttp, WorkerMaintenance } from "../../services/application-worker/maintenance";
import type { WorkerFileSnapshot } from "../../infra/oracle/worker-files";

const at = 1_800_000_000_000;
const artifact = (character: string) => ({ image: `${WORKER_IMAGE}@sha256:${character.repeat(64)}`, digest: `sha256:${character.repeat(64)}`, revision: character.repeat(40) });
const old = artifact("a"), next = artifact("b");
const boot = "00000000-0000-4000-8000-000000000002", rollbackBoot = "00000000-0000-4000-8000-000000000003", drain = "00000000-0000-4000-8000-000000000001";
const imageId = (value: string) => `sha256:${value.repeat(64)}`;
function fixture() {
  let snapshot: WorkerFileSnapshot = { image: old.image, mode: "standby", runner: "vercel", accepting: false, invariantsHash: "c".repeat(64), deployHash: "d".repeat(64) };
  let identity: HostWorkerIdentity = { id: "e".repeat(64), imageId: imageId("a"), image: old.image, status: "running", running: true,
    project: "ir35-worker", service: "worker", bootId: null, ports: [{ HostIp: "127.0.0.1", HostPort: "8787" }] };
  let health: HostWorkerHealth = { ok: true, service: "ir35-queue-worker", mode: "standby", active: 0, handlersActive: 0, submitting: 0,
    browserReady: true, databaseReady: true, maintenance: { phase: "drained", operationId: drain, safeToReplace: true } };
  let now = at;
  const files = { snapshot: vi.fn(async () => structuredClone(snapshot)), maintenanceSecret: vi.fn(async () => "controlled_mock_maintenance_secret_only_12345678"),
    replaceImage: vi.fn(async (_expected: unknown, image: unknown) => { snapshot = { ...snapshot, image: String(image), deployHash: "f".repeat(64) }; return structuredClone(snapshot); }),
    writeOperational: vi.fn(async () => {}),
  };
  const command = vi.fn(async (file: "docker" | "cosign", args: readonly string[]) => {
    if (file === "cosign") {
      const target = args.at(-1)!; const record = target === old.image ? old : next;
      return JSON.stringify([{ critical: { type: "cosign container image signature", image: { "docker-manifest-digest": record.digest } },
        optional: { repository: "IR35careers/IR35", git_ref: "refs/heads/main", git_sha: record.revision } }]);
    }
    expect(args.slice(0, 2)).toEqual(LOCAL_DOCKER_SOCKET);
    if (args[2] === "ps") return identity.id + "\n";
    if (args[2] === "container") return JSON.stringify(identity);
    if (args[2] === "image") {
      const record = args.at(-1) === old.image ? old : next;
      return JSON.stringify({ id: imageId(record === old ? "a" : "b"), architecture: "arm64", os: "linux", digests: [record.image], revision: record.revision });
    }
    return "";
  });
  const http = vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url).hostname).toBe("127.0.0.1"); expect(init.redirect).toBe("error");
    return new Response(JSON.stringify(health), { status: health.ok ? 200 : 503 });
  });
  const host = new WorkerHost("/opt/ir35-worker", { files, command, http, now: () => now,
    env: { PATH: "/controlled", HOME: "/owner", DOCKER_CONFIG: "/private/docker", NODE_ENV: "production", DOCKER_HOST: "attacker", DOCKER_CONTEXT: "unreviewed-remote-context", APPLY_RUNNER: "oracle", GHCR_TOKEN: "controlled_private_credential" } });
  const immutable = vi.fn(async (_revision: string, digest: string) => `${WORKER_IMAGE}@${digest}`);
  const state: UpdateJournalState = { version: 1, revision: 0, mode: "standby", invariantsHash: snapshot.invariantsHash,
    stable: { artifact: old, bootId: null }, previous: null, rejectedDigest: null, transaction: null };
  let durable = state;
  const journal = new WorkerUpdateJournal(state, async value => { durable = structuredClone(value); });
  return { host, files, command, http, immutable, journal, state: () => durable,
    identity: () => identity, setIdentity: (value: Partial<HostWorkerIdentity>) => { identity = { ...identity, ...value }; },
    health: () => health, setHealth: (value: Partial<typeof health>) => { health = { ...health, ...value }; },
    setFiles: (value: Partial<WorkerFileSnapshot>) => { snapshot = { ...snapshot, ...value }; },
    setTime: (value: number) => { now = value; },
  };
}
const prepare = async (f: ReturnType<typeof fixture>) => { await f.host.verifyAndPull(old.image, f.immutable); await f.host.verifyAndPull(next.image, f.immutable); };
async function replacementIntent(f: ReturnType<typeof fixture>) {
  await f.journal.begin({ candidate: next, drainId: drain, candidateBootId: boot, rollbackBootId: rollbackBoot, now: at }, async () => {});
  const observed = await f.host.observe();
  await f.journal.startCandidate(await f.host.journalProof(observed), at, async () => {});
  return observed;
}

describe("actual host command/health/config integration boundaries", () => {
  it("reads only selected non-secret Docker fields and sanitises ambient Docker/Compose/cutover credentials", async () => {
    const f = fixture(); const observed = await f.host.observe();
    expect(observed.identity?.id).toBe("e".repeat(64)); expect(observed.health?.databaseReady).toBe(true);
    expect(WORKER_INSPECT_TEMPLATE).not.toMatch(/\.Env|{{json \.}}/); expect(WORKER_IMAGE_TEMPLATE).not.toMatch(/\.Env|{{json \.}}/);
    for (const call of f.command.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/controlled_private_credential|attacker|APPLICATION_WORKER_ACCEPT_JOBS|--insecure/);
      const options = (call as unknown[])[2] as { env: NodeJS.ProcessEnv };
      expect(options.env).toMatchObject({ PATH: "/controlled", HOME: "/owner", DOCKER_CONFIG: "/private/docker", NODE_ENV: "production" });
      expect(Object.keys(options.env)).toEqual(["PATH", "HOME", "DOCKER_CONFIG", "LANG", "NODE_ENV"]);
    }
    expect(f.http.mock.calls[0][0]).toBe("http://127.0.0.1:8787/health");
    expect(f.http.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it("does not trust health if Docker generation or the configuration changes around its HTTP response", async () => {
    for (const change of ["container", "configuration", "mode"] as const) {
      const f = fixture(); f.http.mockImplementationOnce(async () => {
        if (change === "container") f.setIdentity({ id: "f".repeat(64) });
        if (change === "configuration") f.setFiles({ invariantsHash: "f".repeat(64) });
        return new Response(JSON.stringify({ ...f.health(), ...(change === "mode" ? { mode: "consumer" } : {}) }));
      });
      await expect(f.host.observe()).rejects.toThrow("physical observation failed");
      expect(f.files.replaceImage).not.toHaveBeenCalled();
    }
  });
  it("does not refresh an old health sample's timestamp after a slow Docker/config read", async () => {
    const f = fixture(); const real = f.command.getMockImplementation()!; let inspections = 0;
    f.command.mockImplementation(async (file, args) => {
      const result = await real(file, args);
      if (args[2] === "container" && ++inspections === 2) f.setTime(at + 5001);
      return result;
    });
    await expect(f.host.observe()).rejects.toThrow("physical observation failed");
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])("rejects invalid clocks before any maintenance mutation: %s", async value => {
    const f = fixture(); const observed = await f.host.observe(); f.setTime(value);
    await expect(f.host.control("drain", drain, observed)).rejects.toThrow("acknowledgement is uncertain");
    await expect(f.host.journalProof(observed)).rejects.toThrow("Invalid worker host clock");
    expect(f.http.mock.calls.some(call => call[0].endsWith("/maintenance"))).toBe(false);
    expect(f.files.replaceImage).not.toHaveBeenCalled();
  });
  it("rejects a backwards clock during an otherwise fresh recheck", async () => {
    const f = fixture(); const observed = await f.host.observe(); f.setTime(at + 20);
    const real = f.files.snapshot.getMockImplementation()!;
    f.files.snapshot.mockImplementationOnce(async () => { const result = await real(); f.setTime(at + 10); return result; });
    await expect(f.host.control("drain", drain, observed)).rejects.toThrow("acknowledgement is uncertain");
    expect(f.http.mock.calls.some(call => call[0].endsWith("/maintenance"))).toBe(false);
  });
  it("revalidates freshness after a delayed maintenance credential read", async () => {
    const f = fixture(); const observed = await f.host.observe();
    const real = f.files.maintenanceSecret.getMockImplementation()!;
    f.files.maintenanceSecret.mockImplementationOnce(async () => { const value = await real(); f.setTime(at + 5001); return value; });
    await expect(f.host.control("drain", drain, observed)).rejects.toThrow("acknowledgement is uncertain");
    expect(f.http.mock.calls.some(call => call[0].endsWith("/maintenance"))).toBe(false);
  });
  it("refuses unknown/multiple services, public bindings and inconsistent service identity", async () => {
    for (const input of ["multiple", "public", "project", "boot"] as const) {
      const f = fixture();
      if (input === "multiple") f.command.mockImplementationOnce(async () => "a".repeat(64) + "\n" + "b".repeat(64));
      if (input === "public") f.setIdentity({ ports: [{ HostIp: "0.0.0.0" as "127.0.0.1", HostPort: "8787" }] });
      if (input === "project") f.setIdentity({ project: "other" as "ir35-worker" });
      if (input === "boot") f.setIdentity({ bootId: "malformed" });
      await expect(f.host.observe()).rejects.toThrow("physical observation failed");
    }
  });
  it.each(["redirect", "oversize", "invalid", "status", "down"])("untrusted or unavailable health is not healthy journal proof: %s", async failure => {
    const f = fixture(); f.http.mockImplementation(async () => {
      if (failure === "down" || failure === "redirect") throw new Error("controlled_private_transport_error");
      if (failure === "oversize") return new Response("x".repeat(32_769));
      if (failure === "invalid") return new Response("not json");
      return new Response(JSON.stringify(f.health()), { status: 503 }); // inconsistent ok:true
    });
    const observed = await f.host.observe(); expect(observed.health).toBeNull();
    await expect(f.host.journalProof(observed)).rejects.toThrow("not a healthy journal observation");
  });
  it("verifies exact keyless identity and immutable revision BEFORE pull and validates actual local ARM bytes/revision", async () => {
    const f = fixture(); expect(await f.host.verifyAndPull(next.image, f.immutable)).toEqual(next);
    expect(f.command.mock.calls[0]).toEqual(["cosign", cosignVerifyArgs(next.image), expect.objectContaining({ timeoutMs: 60_000 })]);
    expect(f.immutable).toHaveBeenCalledWith(next.revision, next.digest);
    expect(f.command.mock.calls[1][1]).toEqual([...LOCAL_DOCKER_SOCKET, "pull", "--platform", "linux/arm64", next.image]);
    expect(f.files.replaceImage).not.toHaveBeenCalled();
  });
  it("unsigned, substituted, wrong-architecture and local-revision images never change selection", async () => {
    for (const failure of ["unsigned", "tag", "architecture", "revision"] as const) {
      const f = fixture(); const real = f.command.getMockImplementation()!;
      f.command.mockImplementation(async (file, args) => {
        if (failure === "unsigned" && file === "cosign") throw new Error("controlled_private_diagnostic");
        const text = await real(file, args);
        if (args[2] === "image") return JSON.stringify({ ...JSON.parse(text), ...(failure === "architecture" ? { architecture: "amd64" } : failure === "revision" ? { revision: old.revision } : {}) });
        return text;
      });
      if (failure === "tag") f.immutable.mockResolvedValueOnce(old.image);
      await expect(f.host.verifyAndPull(next.image, f.immutable)).rejects.toThrow("no deployment selection changed");
      expect(f.files.replaceImage).not.toHaveBeenCalled();
      if (["unsigned", "tag"].includes(failure)) expect(f.command.mock.calls.some(call => call[1][2] === "pull")).toBe(false);
    }
  });
  it("a failed repeat signature check clears earlier cached replacement authorisation", async () => {
    const f = fixture(); await prepare(f); const observed = await replacementIntent(f);
    const real = f.command.getMockImplementation()!;
    f.command.mockImplementation(async (file, args) => { if (file === "cosign") throw new Error("controlled private verifier failure"); return real(file, args); });
    await expect(f.host.verifyAndPull(next.image, f.immutable)).rejects.toThrow("no deployment selection changed");
    await expect(f.host.replace(f.state(), observed)).rejects.toThrow("reconcile");
    expect(f.files.replaceImage).not.toHaveBeenCalled();
  });
  it("executes a persisted paused replacement with only the UUID override and no flag/env rewrite", async () => {
    const f = fixture(); await prepare(f); const observed = await replacementIntent(f);
    await f.host.replace(f.state(), observed);
    expect(f.files.writeOperational).toHaveBeenCalledWith("update-override.json", expect.stringContaining(boot));
    expect(f.files.replaceImage).toHaveBeenCalledWith(observed.files, next.image);
    expect(f.command.mock.calls.at(-1)?.[1]).toEqual([...LOCAL_DOCKER_SOCKET, "compose", "--project-directory", "/opt/ir35-worker", "--env-file", "/opt/ir35-worker/deploy.env",
      "--file", "/opt/ir35-worker/docker-compose.yml", "--file", "/opt/ir35-worker/update-override.json",
      "up", "--detach", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", "worker"]);
    expect((await f.files.snapshot()).accepting).toBe(false); expect((await f.files.snapshot()).runner).toBe("vercel");
  });
  it("cannot replace without actual successful signature preparation, fresh identity, zero work and a durable intent", async () => {
    for (const failure of ["unsigned", "stale", "work", "config", "missing-intent", "image-id"] as const) {
      const f = fixture(); if (failure !== "unsigned") await prepare(f);
      const observed = await replacementIntent(f);
      if (failure === "stale") f.setTime(at + 5001);
      if (failure === "work") observed.health!.handlersActive = 1;
      if (failure === "config") f.setFiles({ invariantsHash: "f".repeat(64) });
      if (failure === "image-id") { f.setIdentity({ imageId: imageId("d") }); observed.identity!.imageId = imageId("d"); }
      await expect(f.host.replace(failure === "missing-intent" ? { ...f.state(), transaction: null } : f.state(), observed)).rejects.toThrow("reconcile");
      expect(f.files.replaceImage).not.toHaveBeenCalled();
    }
  });
  it("never rolls back a possibly resumed candidate or a different boot generation", async () => {
    const f = fixture(); await prepare(f); await replacementIntent(f);
    await f.journal.startRollback(at, "health_failed", async () => {});
    f.setFiles({ image: next.image }); f.setIdentity({ image: next.image, imageId: imageId("b"), bootId: boot });
    f.setHealth({ maintenance: { phase: "idle", operationId: null, safeToReplace: false } });
    const observed = await f.host.observe();
    await expect(f.host.replace(f.state(), await f.host.observe())).rejects.toThrow("reconcile");
    expect(f.files.replaceImage).not.toHaveBeenCalled();
    f.setIdentity({ bootId: rollbackBoot });
    await expect(f.host.replace(f.state(), { ...observed, identity: f.identity() })).rejects.toThrow("reconcile");
  });
  it.each(["unready-db", "healthy-paused", "unreachable"])("restores a signed previous image for the exact never-resumed candidate: %s", async failure => {
    const f = fixture(); await prepare(f); await replacementIntent(f);
    await f.journal.startRollback(at, "health_failed", async () => {});
    f.setFiles({ image: next.image }); f.setIdentity({ image: next.image, imageId: imageId("b"), bootId: boot });
    if (failure === "unready-db") f.setHealth({ ok: false, databaseReady: false, submitting: null, maintenance: null });
    if (failure === "healthy-paused") f.setHealth({ maintenance: { phase: "drained", operationId: boot, safeToReplace: true } });
    if (failure === "unreachable") f.http.mockRejectedValue(new Error("controlled private transport"));
    await f.host.replace(f.state(), await f.host.observe());
    expect(f.files.writeOperational).toHaveBeenCalledWith("update-override.json", expect.stringContaining(rollbackBoot));
    expect(f.files.replaceImage).toHaveBeenCalledWith(expect.objectContaining({ image: next.image }), old.image);
    expect((await f.files.snapshot()).accepting).toBe(false); expect(f.state().transaction?.phase).toBe("rollback_starting");
  });
  it("a positively empty Docker inventory after failed candidate creation can restore the signed paused previous image", async () => {
    const f = fixture(); await prepare(f); await replacementIntent(f);
    await f.journal.startRollback(at, "launch_failed", async () => {});
    f.setFiles({ image: next.image });
    const real = f.command.getMockImplementation()!;
    f.command.mockImplementation(async (file, args) => args[2] === "ps" ? "" : real(file, args));
    const observed = await f.host.observe(); expect(observed.identity).toBeNull(); expect(observed.health).toBeNull();
    await f.host.replace(f.state(), observed);
    expect(f.files.replaceImage).toHaveBeenCalledWith(expect.objectContaining({ image: next.image }), old.image);
    expect(f.files.writeOperational).toHaveBeenCalledWith("update-override.json", expect.stringContaining(rollbackBoot));
    expect(f.state().transaction?.phase).toBe("rollback_starting");
  });
  it("does not launch past the original health deadline, or after new flags race with the image-only write", async () => {
    for (const failure of ["deadline", "late-config"] as const) {
      const f = fixture(); await prepare(f); let observed = await replacementIntent(f);
      if (failure === "deadline") { f.setTime(at + 120_000); observed = await f.host.observe(); }
      if (failure === "late-config") {
        const real = f.files.replaceImage.getMockImplementation()!;
        f.files.replaceImage.mockImplementation(async (...args) => {
          const result = await real(...args); f.setFiles({ invariantsHash: "f".repeat(64) }); return result;
        });
      }
      await expect(f.host.replace(f.state(), observed)).rejects.toThrow("reconcile");
      expect(f.command.mock.calls.some(call => call[1][2] === "compose")).toBe(false);
    }
  });
  it("does not replay unknown Compose acknowledgements or leak their error", async () => {
    const f = fixture(); await prepare(f); const observed = await replacementIntent(f);
    const real = f.command.getMockImplementation()!;
    f.command.mockImplementation(async (file, args) => { if (args[2] === "compose") throw new Error("controlled_private_compose_error"); return real(file, args); });
    await expect(f.host.replace(f.state(), observed)).rejects.toThrow("acknowledgement is uncertain");
    expect(f.command.mock.calls.filter(call => call[1][2] === "compose")).toHaveLength(1);
    expect(f.state().transaction?.phase).toBe("candidate_starting");
  });
  it("uses the real loopback HMAC HTTP handler; acknowledgement is distinct from settled maintenance", async () => {
    const f = fixture(); const secret = await f.files.maintenanceSecret();
    const controller = new WorkerMaintenance({ configuredToAccept: false, stopConsumers: async () => {}, startConsumers: async () => {} });
    const server = createServer((request, response) => {
      if (request.url === "/maintenance") { void handleMaintenanceHttp(request, response, { secret, ready: () => true, controller: () => controller }); return; }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ...f.health(), maintenance: controller.snapshot() }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const host = new WorkerHost("/opt/ir35-worker", { files: f.files, command: f.command,
        http: (url, init) => { expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8787\/(health|maintenance)$/); return fetch(url.replace(":8787", `:${port}`), init); } });
      await host.control("drain", drain, await host.observe()); await controller.settled();
      expect(controller.snapshot()).toMatchObject({ phase: "drained", operationId: drain });
      await host.control("resume", drain, await host.observe()); await controller.settled();
      expect(controller.snapshot()).toEqual({ phase: "idle", operationId: null, safeToReplace: false });
      await expect(host.control("resume", boot, await host.observe())).rejects.toThrow("acknowledgement is uncertain");
      expect(f.files.replaceImage).not.toHaveBeenCalled();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
