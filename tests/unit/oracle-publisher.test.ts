import { describe, expect, it } from "vitest";
import { publishWorkerImage, type PublisherPorts } from "../../infra/oracle/publisher";
import { WORKER_IMAGE } from "../../infra/oracle/image-trust";

const revision = "a".repeat(40); const digest = `sha256:${"b".repeat(64)}`;
function fixture(options: { existing?: boolean; mismatch?: boolean; wrongArch?: boolean; gateFails?: number; fail?: "sign" | "verify" | "push" | "promote"; race?: boolean } = {}) {
  const events: string[] = []; let pushed = !!options.existing; let promoted = false; let checks = 0; let resolutions = 0;
  const ports: PublisherPorts = {
    gates: async () => { events.push("gate"); if (++checks === options.gateFails) throw new Error("controlled gate failure"); },
    authenticate: async () => { events.push("authenticate"); },
    resolve: async ref => {
      events.push(`resolve:${ref}`);
      if (ref === "main") return promoted ? digest : null;
      resolutions++; if (options.race && resolutions === 2) return digest;
      return pushed ? digest : null;
    },
    requireImmutableRevision: async (_sha, actual) => {
      events.push("immutable"); if (options.mismatch || actual !== digest) throw new Error("controlled tag mismatch");
    },
    command: async (file, args) => {
      const step = file === "cosign" ? args[0] : args[0] === "buildx" ? "promote" : args[0] === "push" ? "push" : args[3] === "{{.Architecture}}" ? "architecture" : "revision";
      events.push(step); if (options.fail === step) throw new Error(`controlled ${step} failure`);
      if (step === "revision") return revision;
      if (step === "architecture") return options.wrongArch ? "amd64" : "arm64";
      if (step === "push") { pushed = true; return `sha-${revision}: digest: ${digest} size: 1234\n`; }
      if (step === "verify") return JSON.stringify([{ critical: { type: "cosign container image signature", image: { "docker-manifest-digest": digest } },
        optional: { repository: "IR35careers/IR35", git_ref: "refs/heads/main", git_sha: revision } }]);
      if (step === "sign") { expect(args.at(-1)).toBe(`${WORKER_IMAGE}@${digest}`); return ""; }
      if (step === "promote") { expect(args).toContain("--prefer-index=false"); expect(args.at(-1)).toBe(`${WORKER_IMAGE}@${digest}`); promoted = true; return ""; }
      throw new Error("Unexpected command");
    },
  };
  return { ports, events };
}
describe("actual publisher orchestration with injected external commands", () => {
  it("preflights without push/sign/promotion and rejects an unsigned existing tag rather than re-signing it", async () => {
    const fresh = fixture(); expect(await publishWorkerImage({ phase: "preflight", revision }, fresh.ports)).toEqual({ buildNeeded: true, digest: null });
    expect(fresh.events).toHaveLength(3);
    const unsigned = fixture({ existing: true, fail: "verify" });
    await expect(publishWorkerImage({ phase: "preflight", revision }, unsigned.ports)).rejects.toThrow("verify");
    expect(unsigned.events).not.toContain("sign"); expect(unsigned.events).not.toContain("push");
  });
  it("binds push acknowledgement -> immutable tag -> sign -> verified claims -> fresh gates -> identical main digest", async () => {
    const f = fixture(); expect(await publishWorkerImage({ phase: "publish", revision }, f.ports)).toEqual({ buildNeeded: false, digest });
    expect(f.events).toEqual(["gate", "authenticate", `resolve:sha-${revision}`, "revision", "architecture", `resolve:sha-${revision}`,
      "push", "immutable", "sign", "verify", "immutable", "gate", "promote", "resolve:main"]);
  });
  it("an already verified immutable image is promoted without overwriting or re-signing", async () => {
    const f = fixture({ existing: true }); await publishWorkerImage({ phase: "publish", revision }, f.ports);
    expect(f.events).toContain("verify"); expect(f.events).toContain("promote"); expect(f.events).not.toContain("push"); expect(f.events).not.toContain("sign");
  });
  it.each([{ mismatch: true }, { race: true }, { wrongArch: true }, { fail: "push" as const }])("cannot sign a substituted, raced, wrong-architecture or failed push: %j", async options => {
    const f = fixture(options); await expect(publishWorkerImage({ phase: "publish", revision }, f.ports)).rejects.toThrow();
    expect(f.events).not.toContain("sign"); expect(f.events).not.toContain("promote");
  });
  it.each([{ gateFails: 1 }, { gateFails: 2 }, { fail: "sign" as const }, { fail: "verify" as const }])("cannot promote before all signature and fresh release gates pass: %j", async options => {
    const f = fixture(options); await expect(publishWorkerImage({ phase: "publish", revision }, f.ports)).rejects.toThrow();
    expect(f.events).not.toContain("promote");
  });
  it("rejects invalid inputs before any authentication or external side effect", async () => {
    const f = fixture(); await expect(publishWorkerImage({ phase: "publish", revision: "malformed", extra: "not allowed" }, f.ports)).rejects.toThrow();
    expect(f.events).toHaveLength(0);
  });
});
