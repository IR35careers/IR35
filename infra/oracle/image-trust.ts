import { z } from "zod";

export const WORKER_IMAGE = "ghcr.io/ir35careers/ir35-worker";
export const WORKER_REPOSITORY = "IR35careers/IR35";
export const WORKER_SIGNER = `https://github.com/${WORKER_REPOSITORY}/.github/workflows/worker-publish.yml@refs/heads/main`;
export const WORKER_ISSUER = "https://token.actions.githubusercontent.com";
export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const imageSchema = z.string().refine(value => value.startsWith(`${WORKER_IMAGE}@`)
  && digestSchema.safeParse(value.slice(WORKER_IMAGE.length + 1)).success, "Expected this worker's immutable GHCR digest.");

/** Exact identity, repository/ref annotations and default transparency verification. */
export function cosignVerifyArgs(image: unknown): string[] {
  const validated = imageSchema.parse(image);
  return ["verify", "--certificate-identity", WORKER_SIGNER, "--certificate-oidc-issuer", WORKER_ISSUER,
    "--annotations", `repository=${WORKER_REPOSITORY}`, "--annotations", "git_ref=refs/heads/main", "--output", "json", validated];
}

/** Only parse stdout AFTER a successful invocation of the exact cosign verifier above. */
export function readVerifiedImage(image: unknown, stdout: unknown) {
  const validated = imageSchema.parse(image); const digest = validated.slice(WORKER_IMAGE.length + 1);
  const text = z.string().max(262_144).parse(stdout);
  const entries = z.array(z.unknown()).min(1).max(64).parse(JSON.parse(text));
  const signature = z.object({ critical: z.object({ type: z.literal("cosign container image signature"),
    image: z.object({ "docker-manifest-digest": z.literal(digest) }),
  }), optional: z.object({ repository: z.literal(WORKER_REPOSITORY), git_ref: z.literal("refs/heads/main"), git_sha: shaSchema }) });
  const revisions = new Set<string>();
  for (const entry of entries) { const parsed = signature.safeParse(entry); if (parsed.success) revisions.add(parsed.data.optional.git_sha); }
  if (revisions.size !== 1) throw new Error("Missing or conflicting signed worker revision.");
  return { image: validated, digest, revision: [...revisions][0] };
}

export function immutableWorkerTag(revision: unknown) { return `${WORKER_IMAGE}:sha-${shaSchema.parse(revision)}`; }

/** Bind signing to Docker's actual pushed artifact, never a later mutable-tag read. */
export function pushedWorkerDigest(stdout: unknown, revision: unknown) {
  const sha = shaSchema.parse(revision); const text = z.string().max(524_288).parse(stdout);
  const matches = [...text.matchAll(new RegExp(`^sha-${sha}: digest: (sha256:[a-f0-9]{64}) size: \\d+\\s*$`, "gm"))];
  const digests = new Set(matches.map(match => match[1]));
  if (digests.size !== 1) throw new Error("Actual pushed worker digest is unavailable or ambiguous.");
  return digestSchema.parse([...digests][0]);
}
