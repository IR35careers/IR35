import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const exceptionSchema = z.object({
  advisory: z.string().regex(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/),
  package: z.string().min(1), versions: z.array(z.string().min(1)).nonempty(),
  expiresAt: z.iso.datetime(), reason: z.string().min(30),
});
const advisorySchema = z.object({ name: z.string(), url: z.url(), title: z.string() });
const auditSchema = z.object({
  auditReportVersion: z.literal(2),
  vulnerabilities: z.record(z.string(), z.object({
    name: z.string(), nodes: z.array(z.string()),
    via: z.array(z.union([z.string(), advisorySchema])),
  })),
});
const lockSchema = z.object({ packages: z.record(z.string(), z.object({ version: z.string().optional() })) });

/** Exceptions apply to advisory leaves, not broad package names or severities.
 * npm's dependency-level wrapper findings must resolve to those same leaves.
 * Unknown advisories, versions, graphs, malformed results and expiry fail closed.
 */
export function evaluateDependencyAudit(raw: unknown, rawLock: unknown, rawExceptions: unknown, now = new Date()) {
  const audit = auditSchema.parse(raw);
  const lock = lockSchema.parse(rawLock);
  const exceptions = z.array(exceptionSchema).parse(rawExceptions);
  const problems = new Set<string>();
  const accepted = new Set<string>();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid audit clock");
  for (const exception of exceptions) {
    if (new Date(exception.expiresAt).getTime() <= now.getTime()) problems.add(`Expired exception: ${exception.advisory}`);
  }
  const visit = (name: string, parents: Set<string>) => {
    const vulnerability = audit.vulnerabilities[name];
    if (!vulnerability || !vulnerability.via.length || parents.has(name)) {
      problems.add(`Unresolved audit dependency: ${name}`);
      return;
    }
    const path = new Set(parents).add(name);
    for (const via of vulnerability.via) {
      if (typeof via === "string") { visit(via, path); continue; }
      const url = new URL(via.url);
      const id = url.hostname === "github.com" && !url.username && !url.password
        ? /^\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/.exec(url.pathname)?.[1] : undefined;
      const versions = vulnerability.nodes.map((node) => lock.packages[node]?.version);
      const exception = exceptions.find((item) => item.advisory === id && item.package === vulnerability.name
        && via.name === vulnerability.name && new Date(item.expiresAt).getTime() > now.getTime()
        && versions.length > 0 && versions.every((version) => version && item.versions.includes(version)));
      if (exception) accepted.add(`${exception.advisory} (${exception.package} ${versions.join(", ")}) until ${exception.expiresAt}`);
      else problems.add(`${name}: ${id ?? "unrecognized advisory URL"} (${versions.join(", ") || "unknown installed version"})`);
    }
  };
  for (const name of Object.keys(audit.vulnerabilities)) visit(name, new Set());
  return { problems: [...problems], accepted: [...accepted] };
}

function main() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run through npm run security:audit so the pinned npm executable is used.");
  const result = spawnSync(process.execPath, [npmCli, "audit", "--json"], {
    encoding: "utf8", maxBuffer: 16_000_000, timeout: 120_000, windowsHide: true,
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) throw new Error("npm audit failed to return a complete result.");
  const raw = JSON.parse(result.stdout) as Record<string, unknown>;
  if (raw.error) throw new Error("npm audit returned an error; exceptions cannot bypass unavailable audit results.");
  const evaluated = evaluateDependencyAudit(raw,
    JSON.parse(readFileSync("package-lock.json", "utf8")),
    JSON.parse(readFileSync("security/audit-exceptions.json", "utf8")));
  for (const item of evaluated.accepted) console.warn(`TEMPORARY OWNER-APPROVED EXCEPTION: ${item}`);
  for (const item of evaluated.problems) console.error(`BLOCKING: ${item}`);
  if (evaluated.problems.length) process.exitCode = 1;
  else console.log("Dependency audit passed with only the explicitly listed, unexpired exceptions (if any).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) {
    console.error(error instanceof z.ZodError ? "Dependency audit input failed validation." : error instanceof Error ? error.message : "Dependency audit failed.");
    process.exitCode = 1;
  }
}
