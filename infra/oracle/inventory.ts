import { z } from "zod";
import { createHash } from "node:crypto";

const name = z.string().min(1).max(512);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{32}$/);
const table = z.strictObject({ schema: name, name, rls: z.boolean(), force_rls: z.boolean(),
  is_partition: z.boolean(), bytes: count, rows: count });

/** Explicit allowlist: never serialize arbitrary CLI/provider responses. */
export const oracleInventorySchema = z.strictObject({
  catalogVersion: z.literal(1), checkedAt: z.iso.datetime(),
  serverVersion: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/), databaseBytes: count,
  schemas: z.array(name),
  extensions: z.array(z.strictObject({ name, version: name, schema: name })),
  tables: z.array(table),
  policies: z.array(z.strictObject({ schema: name, table_name: name, name, permissive: name,
    roles: name, cmd: name, using_hash: hash, check_hash: hash })),
  functions: z.array(z.strictObject({ schema: name, name, identity_arguments: z.string().max(8192),
    security_definer: z.boolean(), definition_hash: hash, extension_owned: z.boolean() })),
  triggers: z.array(z.strictObject({ schema: name, table_name: name, name, enabled: name,
    function_name: name, definition_hash: hash })),
  buckets: z.array(z.strictObject({ id: name, public: z.boolean(), objects: count,
    object_bytes: count, missing_size_metadata: count })),
  identityProvidersInUse: z.array(z.strictObject({ provider: name, identities: count })),
  publications: z.array(z.strictObject({ publication: name, schema: name, table: name })),
  migrationVersions: z.array(z.string().regex(/^\d+$/)),
});
export type OracleInventory = z.infer<typeof oracleInventorySchema>;

export function parseOracleInventory(value: unknown): OracleInventory {
  // The CLI's boundary/warning envelope is not database evidence or instructions.
  const envelope = z.object({ rows: z.array(z.strictObject({ inventory: oracleInventorySchema })).length(1) }).safeParse(value);
  if (!envelope.success) throw new Error("Inventory validation failed; raw data and validation values are suppressed.");
  return envelope.data.rows[0].inventory;
}

export function assertPublicRls(value: unknown): void {
  const parsed = z.array(table).safeParse(value);
  if (!parsed.success) throw new Error("RLS inventory is invalid; raw values are suppressed.");
  if (!parsed.data.some(row => row.schema === "public")) throw new Error("RLS check is incomplete: no public tables were observed.");
  // No extension-table or legacy exceptions: report a blocker, never repair prod.
  if (parsed.data.some(row => row.schema === "public" && !row.rls))
    throw new Error("RLS check failed: at least one public table has RLS disabled. No database changes made.");
}

/** No secret values or raw template HTML leave the dry-run response boundary. */
export function summarizeConfigPull(value: unknown) {
  const path = z.union([z.string(), z.array(z.string())]).transform(v => Array.isArray(v) ? v.join(".") : v)
    .pipe(z.string().regex(/^[a-zA-Z0-9_.-]{1,512}$/));
  const parsed = z.object({ dry_run: z.literal(true), wrote: z.literal(false),
    changes: z.array(z.object({ path, remote: z.unknown() })) }).safeParse(value);
  if (!parsed.success) throw new Error("Config dry-run metadata is invalid; raw values suppressed.");
  type Summary = { field: string; type: string; value?: boolean; configured?: boolean; htmlSha256?: string };
  const fields: Summary[] = [];
  function visit(field: string, input: unknown, depth: number) {
    if (depth > 12 || fields.length > 2000) throw new Error("Config metadata limit exceeded.");
    if (typeof input === "boolean") fields.push({ field, type: "boolean", value: input });
    else if (typeof input === "string") fields.push({ field, type: "string", configured: input.length > 0,
      ...(/template/i.test(field) && /^\s*(?:<!doctype|<html)/i.test(input)
        ? { htmlSha256: createHash("sha256").update(input).digest("hex") } : {}) });
    else if (input === null || typeof input !== "object") fields.push({ field, type: input === null ? "null" : typeof input });
    else if (Array.isArray(input)) fields.push({ field, type: "array" });
    else for (const [key, child] of Object.entries(input)) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(key)) throw new Error("Config metadata field invalid.");
      visit(`${field}.${key}`, child, depth + 1);
    }
  }
  for (const change of parsed.data.changes) visit(change.path, change.remote, 0);
  return { dryRun: true, wrote: false, scope: "changed remote config fields, not all settings or secret validity", fields };
}

export function scanMigrationSource(files: Record<string, string>) {
  const checked = z.record(z.string().regex(/^[a-zA-Z0-9_./\[\]@() -]+$/), z.string()).safeParse(files);
  if (!checked.success) throw new Error("Source inventory input invalid.");
  const env = new Map<string, Set<string>>();
  const features: { file: string; line: number; feature: string }[] = [];
  const patterns: [string, RegExp][] = [
    ["vercel-runtime-import", /["']@vercel\//], ["vercel-runtime-branch", /process\.env\.VERCEL\b/],
    ["vercel-forwarded-header", /x-vercel-/], ["next-cache", /next\/cache|unstable_cache|revalidateTag|revalidatePath/],
    ["next-image", /["']next\/image["']/], ["next-after", /\bafter\(/],
    ["runtime-limit", /export const (?:runtime|maxDuration|preferredRegion)/],
    ["route-cache", /export const (?:revalidate|dynamic|dynamicParams)/],
    ["static-params", /generateStaticParams/], ["google-analytics", /googletagmanager|google-analytics|GoogleAnalytics/],
  ];
  for (const [file, content] of Object.entries(checked.data)) {
    const names = new Set<string>();
    for (const match of content.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])/g)) names.add(match[1] || match[2]);
    // Env templates and shell/Compose references provide names, never values.
    if (/\.env[^/]*example$/.test(file)) for (const match of content.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) names.add(match[1]);
    if (/docker-compose[^/]*\.ya?ml$/.test(file))
      for (const match of content.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?:[:}])/g)) names.add(match[1]);
    for (const match of content.matchAll(/\$env:([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);
    for (const match of content.matchAll(/secrets\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);
    if (/\.(?:safeParse|parse)\(process\.env\)/.test(content))
      for (const match of content.matchAll(/\b([A-Z][A-Z0-9_]{2,})\s*:\s*z\./g)) names.add(match[1]);
    for (const key of names) { if (!env.has(key)) env.set(key, new Set()); env.get(key)!.add(file); }
    content.split(/\r?\n/).forEach((line, index) => {
      for (const [feature, pattern] of patterns) if (pattern.test(line)) features.push({ file, line: index + 1, feature });
    });
  }
  return { sourceFiles: Object.keys(files).length,
    environmentNames: [...env].sort(([a], [b]) => a.localeCompare(b)).map(([name, paths]) => ({ name, files: [...paths].sort() })),
    features, valuesIncluded: false,
  };
}

export function summarizeVercelProject(value: unknown) {
  const metadata = z.object({
    name: z.string(), framework: z.literal("nextjs"), nodeVersion: z.string(),
    link: z.object({ productionBranch: z.string() }),
    crons: z.object({ enabledAt: z.number().nullable(), disabledAt: z.number().nullable(),
      definitions: z.array(z.object({ path: z.string().startsWith("/"), schedule: z.string() })) }),
    targets: z.object({ production: z.object({ id: z.string().startsWith("dpl_"),
      meta: z.object({ githubCommitSha: z.string().regex(/^[a-f0-9]{40}$/), githubCommitRef: z.string() }) }) }),
    env: z.array(z.object({ key: z.string().regex(/^[A-Z][A-Z0-9_]*$/), target: z.array(z.enum(["production", "preview", "development"])), type: z.string() })),
    speedInsights: z.object({ hasData: z.boolean() }).optional(),
  }).safeParse(value);
  if (!metadata.success) throw new Error("Vercel project metadata invalid; raw response suppressed.");
  const p = metadata.data;
  return { name: p.name, framework: p.framework, nodeVersion: p.nodeVersion, productionBranch: p.link.productionBranch,
    productionDeployment: p.targets.production.id, productionCommit: p.targets.production.meta.githubCommitSha,
    productionRef: p.targets.production.meta.githubCommitRef,
    cronEnabled: p.crons.enabledAt !== null && p.crons.disabledAt === null, crons: p.crons.definitions,
    environmentNames: p.env.map(row => ({ name: row.key, targets: row.target, type: row.type })),
    speedInsightsHasData: p.speedInsights?.hasData ?? null,
  };
}
