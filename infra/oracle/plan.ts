import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOracleProvisionPlan } from "./provision-plan";

/** Deliberately offline: a plan is not free-tier proof or permission to provision. */
export function main(args: string[]) {
  if (args.length !== 2 || args[0] !== "--config" || !args[1] || args[1].startsWith("--")) {
    throw new Error("Usage: npm run worker:oracle:plan -- --config <non-secret-config.json>. Offline only; no --apply option.");
  }
  const fd = openSync(resolve(args[1]), "r");
  const bytes = Buffer.alloc(16385);
  let length: number;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16384) throw new Error("Public plan config must be a small regular file.");
    length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > 16384) throw new Error("Public plan config is too large.");
  } finally { closeSync(fd); }
  const content = bytes.subarray(0, length).toString("utf8");
  const plan = createOracleProvisionPlan(JSON.parse(content));
  // No raw input, keys, metadata, credentials or OCI responses printed.
  console.log(JSON.stringify({ mode: plan.mode, hash: plan.hash, target: plan.target,
    network: { ingress: [{ source: plan.config.sshCidr, port: 22, protocol: "tcp" }], publicHealth: false },
    prerequisites: plan.prerequisites, flags: { APPLY_RUNNER: "vercel", APPLICATION_WORKER_ACCEPT_JOBS: false },
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch { console.error("Oracle offline plan failed; check the public config/usage. No OCI call or resource creation occurred."); process.exitCode = 1; }
}
