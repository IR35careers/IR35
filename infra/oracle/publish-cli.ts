import { appendFile, chmod } from "node:fs/promises";
import { z } from "zod";
import { WORKER_REPOSITORY } from "./image-trust";
import { hostCommand, dockerEnvironment } from "./host-command";
import { WorkerRegistry } from "./registry";
import { verifyPublicationGates } from "./publication";
import { publishWorkerImage } from "./publisher";

async function main() {
  const config = z.object({ GITHUB_ACTIONS: z.literal("true"), GITHUB_REPOSITORY: z.literal(WORKER_REPOSITORY),
    GITHUB_REF: z.literal("refs/heads/main"), SOURCE_SHA: z.string().regex(/^[a-f0-9]{40}$/),
    GHCR_TOKEN: z.string().min(20), GITHUB_ACTOR: z.string().min(1), GITHUB_OUTPUT: z.string().min(1),
    DOCKER_CONFIG: z.string().min(1),
  }).safeParse(process.env);
  const phase = z.enum(["preflight", "publish"]).safeParse(process.argv[2]);
  if (!config.success || !phase.success || process.argv.length !== 3) throw new Error("Invalid trusted publisher context.");
  const env = config.data; const childEnv = dockerEnvironment(process.env);
  const registry = new WorkerRegistry({ username: env.GITHUB_ACTOR, credential: env.GHCR_TOKEN });
  const request = async (path: string): Promise<unknown> => {
    const response = await fetch(`https://api.github.com${path}`, { redirect: "error", signal: AbortSignal.timeout(20_000), headers: {
      authorization: `Bearer ${env.GHCR_TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28",
    } });
    if (!response.ok) throw new Error("Publication gate unavailable.");
    // These fixed public metadata requests have no candidate data. Bound the response.
    const reader = response.body?.getReader(); if (!reader) throw new Error("Missing gate response.");
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break;
        length += part.value.length; if (length > 524_288) { await reader.cancel(); throw new Error("Gate response too large."); } chunks.push(part.value); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally { reader.releaseLock(); }
  };
  const result = await publishWorkerImage({ phase: phase.data, revision: env.SOURCE_SHA }, {
    gates: revision => verifyPublicationGates(revision, request),
    authenticate: async () => {
      await hostCommand("docker", ["login", "ghcr.io", "--username", env.GITHUB_ACTOR, "--password-stdin"], { env: childEnv, input: env.GHCR_TOKEN });
      await chmod(`${env.DOCKER_CONFIG}/config.json`, 0o600);
    },
    resolve: ref => registry.resolve(ref),
    requireImmutableRevision: (revision, digest) => registry.requireImmutableRevision(revision, digest),
    command: (file, args, timeoutMs) => hostCommand(file, args, {
      timeoutMs, env: file === "cosign" && args[0] === "sign" ? { ...childEnv, GITHUB_ACTIONS: "true",
        ACTIONS_ID_TOKEN_REQUEST_URL: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN } : childEnv,
    }),
  });
  if (phase.data === "preflight") {
    await appendFile(env.GITHUB_OUTPUT, `build_needed=${result.buildNeeded ? "true" : "false"}\n`, { encoding: "utf8" });
    return;
  }
  await appendFile(env.GITHUB_OUTPUT, `image_digest=${result.digest}\n`, { encoding: "utf8" });
  console.info("worker_image_signed_and_promoted", { revision: env.SOURCE_SHA, digest: result.digest });
}
void main().catch(() => { console.error("Worker publication refused or failed. No credentials or raw subprocess output emitted."); process.exit(1); });
