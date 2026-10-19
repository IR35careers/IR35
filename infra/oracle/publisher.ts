import { z } from "zod";
import { cosignVerifyArgs, immutableWorkerTag, pushedWorkerDigest, readVerifiedImage, shaSchema, WORKER_IMAGE, WORKER_REPOSITORY } from "./image-trust";

export type PublisherPorts = {
  gates: (revision: string) => Promise<unknown>;
  authenticate: () => Promise<void>;
  resolve: (reference: string) => Promise<string | null>;
  requireImmutableRevision: (revision: string, digest: string) => Promise<unknown>;
  command: (file: "docker" | "cosign", args: readonly string[], timeoutMs?: number) => Promise<string>;
};

/** One orchestration used by the actual CLI and fault-injection tests. No secrets. */
export async function publishWorkerImage(input: unknown, ports: PublisherPorts) {
  const { phase, revision } = z.strictObject({ phase: z.enum(["preflight", "publish"]), revision: shaSchema }).parse(input);
  await ports.gates(revision); await ports.authenticate();
  const verify = async (digest: string) => {
    const image = `${WORKER_IMAGE}@${digest}`;
    const metadata = readVerifiedImage(image, await ports.command("cosign", cosignVerifyArgs(image)));
    if (metadata.revision !== revision) throw new Error("Signed image does not match this main commit.");
    await ports.requireImmutableRevision(revision, metadata.digest);
    return metadata;
  };
  const tag = immutableWorkerTag(revision); const reference = `sha-${revision}`;
  const existing = await ports.resolve(reference);
  if (phase === "preflight") {
    // An unsigned existing tag is NOT safe to re-sign: its source is unproven.
    if (existing) await verify(existing);
    return { buildNeeded: !existing, digest: existing };
  }
  let digest = existing;
  if (!existing) {
    const actualRevision = (await ports.command("docker", ["image", "inspect", "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}', tag])).trim();
    const architecture = (await ports.command("docker", ["image", "inspect", "--format", "{{.Architecture}}", tag])).trim();
    if (actualRevision !== revision || architecture !== "arm64") throw new Error("Actual local image revision/architecture mismatch.");
    if (await ports.resolve(reference)) throw new Error("Immutable tag appeared concurrently; publication stopped.");
    digest = pushedWorkerDigest(await ports.command("docker", ["push", tag], 300_000), revision);
    await ports.requireImmutableRevision(revision, digest);
    await ports.command("cosign", ["sign", "--yes", "--annotations", `repository=${WORKER_REPOSITORY}`,
      "--annotations", "git_ref=refs/heads/main", "--annotations", `git_sha=${revision}`, `${WORKER_IMAGE}@${digest}`], 180_000);
  }
  if (!digest) throw new Error("No verified image.");
  await verify(digest);
  await ports.gates(revision); // Do not knowingly promote an older build after main moves.
  await ports.command("docker", ["buildx", "imagetools", "create", "--prefer-index=false", "--tag", `${WORKER_IMAGE}:main`, `${WORKER_IMAGE}@${digest}`]);
  if (await ports.resolve("main") !== digest) throw new Error("Main alias did not preserve the signed digest.");
  return { buildNeeded: false, digest };
}
