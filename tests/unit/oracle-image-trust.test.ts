import { describe, expect, it } from "vitest";
import { cosignVerifyArgs, immutableWorkerTag, pushedWorkerDigest, readVerifiedImage, WORKER_IMAGE, WORKER_ISSUER, WORKER_SIGNER } from "../../infra/oracle/image-trust";
import { WorkerRegistry } from "../../infra/oracle/registry";

const digest = `sha256:${"a".repeat(64)}`; const sha = "b".repeat(40); const image = `${WORKER_IMAGE}@${digest}`;
const signature = () => ({ critical: { type: "cosign container image signature", image: { "docker-manifest-digest": digest } },
  optional: { repository: "IR35careers/IR35", git_ref: "refs/heads/main", git_sha: sha } });
const credential = "controlled_registry_fixture_only_12345";

describe("fixed keyless worker image policy", () => {
  it("pins identity/issuer/ref/repository and digest, without insecure verification switches", () => {
    const args = cosignVerifyArgs(image);
    expect(args).toEqual(["verify", "--certificate-identity", WORKER_SIGNER, "--certificate-oidc-issuer", WORKER_ISSUER,
      "--annotations", "repository=IR35careers/IR35", "--annotations", "git_ref=refs/heads/main", "--output", "json", image]);
    expect(args.join(" ")).not.toMatch(/insecure|ignore|skip|identity-regexp|:main/);
    expect(immutableWorkerTag(sha)).toBe(`${WORKER_IMAGE}:sha-${sha}`);
    expect(readVerifiedImage(image, JSON.stringify([signature()]))).toEqual({ image, digest, revision: sha });
  });
  it.each(["ghcr.io/attacker/worker@" + digest, WORKER_IMAGE + ":main", image + "\n--insecure-ignore-tlog", image.replace("a", "g"), null])("rejects arbitrary, mutable or malformed references: %s", value => {
    expect(() => cosignVerifyArgs(value)).toThrow();
  });
  it.each(["repository", "git_ref", "git_sha"] as const)("requires the signed %s annotation", key => {
    const value = signature(); value.optional[key] = "wrong";
    expect(() => readVerifiedImage(image, JSON.stringify([value]))).toThrow();
  });
  it("rejects wrong digest, absent/ambiguous revisions, malformed and bounded oversized output", () => {
    const wrongDigest = signature(); wrongDigest.critical.image["docker-manifest-digest"] = `sha256:${"c".repeat(64)}`;
    const conflict = signature(); conflict.optional.git_sha = "c".repeat(40);
    for (const value of ["invalid", "[]", JSON.stringify([wrongDigest]), JSON.stringify([signature(), conflict]), "x".repeat(262_145)])
      expect(() => readVerifiedImage(image, value)).toThrow();
  });
  it("signs only the digest acknowledged by the actual push, not an untrusted tag substituted afterwards", () => {
    const output = `Preparing layers\nsha-${sha}: digest: ${digest} size: 1234\n`;
    expect(pushedWorkerDigest(output, sha)).toBe(digest);
    for (const text of ["", `main: digest: ${digest} size: 1234`, output.replace(sha, "c".repeat(40)),
      output + `sha-${sha}: digest: sha256:${"c".repeat(64)} size: 2222\n`]) expect(() => pushedWorkerDigest(text, sha)).toThrow();
  });
});

function transport(options: { status?: number; scopes?: string; login?: string; header?: string; tokenStatus?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === "https://api.github.com/user") return new Response(JSON.stringify({ login: options.login ?? "ir35-owner" }), { status: 200, headers: { "x-oauth-scopes": options.scopes ?? "read:packages" } });
    if (url.includes("/token?")) return new Response(JSON.stringify({ token: "controlled_disposable_registry_token" }), { status: options.tokenStatus ?? 200 });
    return new Response(null, { status: options.status ?? 200, headers: { "docker-content-digest": options.header ?? digest } });
  };
  return { calls, registry: new WorkerRegistry({ username: "ir35-owner", credential }, http) };
}
describe("bounded fixed-host read-only GHCR transport", () => {
  it("validates only read:packages and resolves the immutable manifest without secrets in URLs", async () => {
    const { registry, calls } = transport(); await registry.verifyReadOnlyScope();
    expect(await registry.resolve("main")).toBe(digest);
    expect(await registry.requireImmutableRevision(sha, digest)).toBe(image);
    expect(calls.every(call => !call.url.includes(credential) && call.init.redirect === "error")).toBe(true);
    expect(calls.find(call => call.url.includes("/manifests/main"))?.init.method).toBe("HEAD");
    expect(calls.find(call => call.url.includes("/token?"))?.url.endsWith("%3Apull")).toBe(true);
  });
  it.each(["repo, read:packages", "write:packages, read:packages", "delete:packages", "", "read:packages, read:packages"])("rejects a credential with any other scope set: %s", async scopes => {
    await expect(transport({ scopes }).registry.verifyReadOnlyScope()).rejects.toThrow("only read:packages");
  });
  it("rejects wrong owner and missing/mismatched immutable tags", async () => {
    await expect(transport({ login: "someone-else" }).registry.verifyReadOnlyScope()).rejects.toThrow();
    await expect(transport({ status: 404 }).registry.requireImmutableRevision(sha, digest)).rejects.toThrow("immutable worker tag");
    await expect(transport({ header: `sha256:${"c".repeat(64)}` }).registry.requireImmutableRevision(sha, digest)).rejects.toThrow("immutable worker tag");
  });
  it("only treats an authenticated manifest 404 as absent; transport/auth/malformed results fail closed", async () => {
    expect(await transport({ status: 404 }).registry.resolve("main")).toBeNull();
    for (const options of [{ status: 401 }, { status: 403 }, { status: 500 }, { header: "not-a-digest" }, { tokenStatus: 401 }])
      await expect(transport(options).registry.resolve("main")).rejects.toThrow("no image selection changed");
  });
  it("redacts malformed credentials and network exceptions, refuses unbounded responses or attacker references", async () => {
    expect(() => new WorkerRegistry({ username: "invalid/owner", credential })).toThrow("Invalid registry credential");
    const marker = "private-do-not-echo";
    const throwing = new WorkerRegistry({ username: "ir35-owner", credential }, async () => { throw new Error(marker); });
    await expect(throwing.resolve("main")).rejects.not.toThrow(marker);
    await expect(throwing.verifyReadOnlyScope()).rejects.not.toThrow(marker);
    const oversized = new WorkerRegistry({ username: "ir35-owner", credential }, async () => new Response("x".repeat(40_000)));
    await expect(oversized.resolve("main")).rejects.toThrow("no image selection changed");
    const { registry, calls } = transport();
    await expect(registry.resolve("../../attacker")).rejects.toThrow(); expect(calls).toHaveLength(0);
  });
});
