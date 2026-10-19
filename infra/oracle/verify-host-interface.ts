import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { dockerEnvironment, hostCommand } from "./host-command";
import { WORKER_IMAGE } from "./image-trust";
import { LOCAL_DOCKER_SOCKET, WorkerHost, WORKER_IMAGE_TEMPLATE, WORKER_INSPECT_TEMPLATE } from "./worker-host";
import type { WorkerFileSnapshot } from "./worker-files";

// CI-only compatibility/negative-control probe. It does NOT manufacture signed
// provenance, relax the host image policy, contact GHCR or install an updater.
async function main() {
  if (process.platform !== "linux" || process.arch !== "arm64" || process.env.GITHUB_ACTIONS !== "true"
    || process.env.GITHUB_REPOSITORY !== "IR35careers/IR35" || process.env.RUNNER_ARCH !== "ARM64")
    throw new Error();
  const directory = await mkdtemp(join(tmpdir(), "ir35-host-interface-"));
  const config = join(directory, "config.json");
  let container: string | null = null;
  const env = dockerEnvironment({ ...process.env, DOCKER_CONFIG: directory,
    DOCKER_HOST: "tcp://127.0.0.1:1", DOCKER_CONTEXT: "unreviewed-remote-context" });
  const docker = (args: readonly string[]) => hostCommand("docker", [...LOCAL_DOCKER_SOCKET, ...args], { env, timeoutMs: 15_000 });
  const id = z.string().regex(/^[a-f0-9]{64}$/);
  try {
    await writeFile(config, JSON.stringify({ currentContext: "ir35-negative-control-context-does-not-exist" }), { mode: 0o600, flag: "wx" });
    // The same config must fail WITHOUT the explicit local daemon pin.
    await assert.rejects(hostCommand("docker", ["info", "--format", "{{.OSType}}"], { env, timeoutMs: 2000 }));
    assert.equal((await docker(["ps", "--all", "--filter", "label=com.docker.compose.project=ir35-worker", "--format", "{{.ID}}"])).trim(), "");
    const local = z.object({ id: z.string().regex(/^sha256:[a-f0-9]{64}$/), architecture: z.literal("arm64"), os: z.literal("linux"),
      digests: z.array(z.string()).nullable(), revision: z.string().nullable(),
    }).parse(JSON.parse(await docker(["image", "inspect", "--format", WORKER_IMAGE_TEMPLATE, "ir35-worker:arm-ci"])));
    const canary = "controlled-ci-canary-not-a-secret";
    const boot = "00000000-0000-4000-8000-000000000004";
    container = id.parse((await docker(["run", "--detach", "--name", "ir35-host-interface-ci", "--memory", "128m", "--pids-limit", "64",
      "--label", "com.docker.compose.project=ir35-worker", "--label", "com.docker.compose.service=worker",
      "--label", "com.ir35careers.update-operation=" + boot, "--publish", "127.0.0.1:8787:8787", "--env", "IR35_TEST_CANARY=" + canary,
      "--entrypoint", "node", "ir35-worker:arm-ci", "-e", "setInterval(()=>{},1000)"])).trim());
    const selected = await docker(["container", "inspect", "--format", WORKER_INSPECT_TEMPLATE, container]);
    assert.equal(selected.includes(canary), false);
    const physical = z.object({ id, imageId: z.string(), image: z.literal("ir35-worker:arm-ci"), running: z.literal(true),
      status: z.literal("running"), project: z.literal("ir35-worker"), service: z.literal("worker"), bootId: z.literal(boot),
      ports: z.array(z.strictObject({ HostIp: z.literal("127.0.0.1"), HostPort: z.literal("8787") })).length(1),
    }).parse(JSON.parse(selected));
    assert.equal(physical.id, container); assert.equal(physical.imageId, local.id);
    let httpCalls = 0;
    const snapshot: WorkerFileSnapshot = { image: WORKER_IMAGE + "@sha256:" + "a".repeat(64), mode: "standby", runner: "vercel",
      accepting: false, invariantsHash: "b".repeat(64), deployHash: "c".repeat(64) };
    const unexpected = async (): Promise<never> => { throw new Error(); };
    const host = new WorkerHost("/opt/ir35-worker", { env,
      files: { snapshot: async () => structuredClone(snapshot), maintenanceSecret: unexpected, replaceImage: unexpected, writeOperational: unexpected },
      http: async () => { httpCalls++; throw new Error(); },
    });
    // Actual Docker metadata from a local/mutable image MUST be ineligible;
    // no fixture digest is substituted and no health request can authorise it.
    await assert.rejects(host.observe(), /physical observation failed/);
    assert.equal(httpCalls, 0);
    console.log("Native Docker selected-field/socket/local-image rejection probe passed; no signed-image or hosted health claim.");
  } finally {
    if (container) await docker(["rm", "--force", id.parse(container)]);
    await unlink(config); await rmdir(directory);
  }
}
main().catch(() => { console.error("Host interface CI probe failed; no container environment or private diagnostics emitted."); process.exitCode = 1; });
