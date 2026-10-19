import { z } from "zod";
import { digestSchema, shaSchema, WORKER_IMAGE } from "./image-trust";

const usernameSchema = z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i);
const tokenSchema = z.string().min(20).max(512).regex(/^[A-Za-z\d_]+$/);
type Http = (url: string, init: RequestInit) => Promise<Response>;

async function boundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body) throw new Error("Missing registry response.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) { await reader.cancel(); throw new Error("Response too large."); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

/** Public GitHub/GHCR hosts only; credentials never enter URLs/arguments/errors. */
export class WorkerRegistry {
  private readonly username: string;
  private readonly credential: string;
  constructor(input: unknown, private readonly http: Http = fetch) {
    const parsed = z.strictObject({ username: usernameSchema, credential: tokenSchema }).safeParse(input);
    if (!parsed.success) throw new Error("Invalid registry credential configuration.");
    this.username = parsed.data.username; this.credential = parsed.data.credential;
  }
  /** Agent-run bootstrap gate. GITHUB_TOKEN is NOT a VM pull credential. */
  async verifyReadOnlyScope(): Promise<void> {
    try {
      const response = await this.http("https://api.github.com/user", { redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${this.credential}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" } });
      if (response.status !== 200) throw new Error();
      const scopes = (response.headers.get("x-oauth-scopes") ?? "").split(",").map(scope => scope.trim()).filter(Boolean);
      const user = z.object({ login: usernameSchema }).parse(await boundedJson(response, 32_768));
      if (scopes.length !== 1 || scopes[0] !== "read:packages" || user.login.toLowerCase() !== this.username.toLowerCase()) throw new Error();
    } catch { throw new Error("VM registry credential must belong to the configured user and have only read:packages scope."); }
  }
  async resolve(reference: unknown): Promise<string | null> {
    try {
      const ref = z.string().refine(value => value === "main" || /^sha-[a-f0-9]{40}$/.test(value)
        || digestSchema.safeParse(value).success).parse(reference);
      const authorization = `Basic ${Buffer.from(`${this.username}:${this.credential}`).toString("base64")}`;
      const authenticated = await this.http("https://ghcr.io/token?service=ghcr.io&scope=repository%3Air35careers%2Fir35-worker%3Apull", {
        redirect: "error", signal: AbortSignal.timeout(15_000), headers: { authorization },
      });
      if (authenticated.status !== 200) throw new Error();
      const token = z.object({ token: z.string().min(20).max(20_000) }).parse(await boundedJson(authenticated, 32_768)).token;
      const manifest = await this.http(`https://ghcr.io/v2/ir35careers/ir35-worker/manifests/${ref}`, {
        method: "HEAD", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token}`,
          accept: "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" },
      });
      if (manifest.status === 404) return null;
      if (manifest.status !== 200) throw new Error();
      return digestSchema.parse(manifest.headers.get("docker-content-digest"));
    } catch { throw new Error("Worker registry resolution failed; no image selection changed."); }
  }
  async requireImmutableRevision(revision: unknown, digest: unknown) {
    const sha = shaSchema.parse(revision); const expected = digestSchema.parse(digest);
    if (await this.resolve(`sha-${sha}`) !== expected) throw new Error("Signed revision does not match its immutable worker tag.");
    return `${WORKER_IMAGE}@${expected}`;
  }
}
