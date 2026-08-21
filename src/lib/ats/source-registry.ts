import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { COMPANY_CONFIGS } from "./index";
import type { ATSType, CompanyConfig } from "./types";

export const FREE_ATS_TYPES = ["greenhouse", "lever", "ashby", "workable"] as const;
export type FreeATSType = (typeof FREE_ATS_TYPES)[number];

export interface ManagedJobSource extends CompanyConfig {
  id: string;
  type: FreeATSType;
  enabled: boolean;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedJobSourceInput {
  name?: unknown;
  type?: unknown;
  slug?: unknown;
}

const REGISTRY_RUN_TYPE = "job_source_registry";
const MAX_SOURCES = 100;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

export function sourceId(type: FreeATSType, slug: string): string {
  return `${type}:${slug}`;
}

export function validateManagedJobSource(input: ManagedJobSourceInput): CompanyConfig & { type: FreeATSType } {
  const name = cleanText(input.name, 100);
  const type = cleanText(input.type, 20).toLowerCase();
  const slug = cleanText(input.slug, 100).toLowerCase();

  if (name.length < 2) throw new Error("Enter the employer or agency name.");
  if (!FREE_ATS_TYPES.includes(type as FreeATSType)) throw new Error("Choose a supported free ATS provider.");
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error("Enter only the board identifier, using letters, numbers, dots, underscores or hyphens.");
  }

  return { name, type: type as FreeATSType, slug };
}

function defaultSources(now = new Date().toISOString()): ManagedJobSource[] {
  return COMPANY_CONFIGS.flatMap((source) => {
    if (!FREE_ATS_TYPES.includes(source.type as FreeATSType)) return [];
    const type = source.type as FreeATSType;
    return [{
      ...source,
      type,
      id: sourceId(type, source.slug),
      enabled: true,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    }];
  });
}

export function mergeManagedSourceDefaults(
  stored: ManagedJobSource[],
  defaults: ManagedJobSource[] = defaultSources()
): ManagedJobSource[] {
  const defaultIds = new Set(defaults.map((source) => source.id));
  const merged = stored.map((source) => defaultIds.has(source.id) ? { ...source, builtIn: true } : source);
  for (const source of defaults) {
    if (!merged.some((item) => item.id === source.id)) merged.push(source);
  }
  return normaliseManagedSources(merged);
}

function parseStoredSource(value: unknown): ManagedJobSource | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  let source: ReturnType<typeof validateManagedJobSource>;
  try {
    source = validateManagedJobSource(row);
  } catch {
    return null;
  }
  const now = new Date().toISOString();
  const createdAt = cleanText(row.createdAt, 40) || now;
  const updatedAt = cleanText(row.updatedAt, 40) || createdAt;
  return {
    ...source,
    id: sourceId(source.type, source.slug),
    enabled: row.enabled !== false,
    builtIn: row.builtIn === true,
    createdAt,
    updatedAt,
  };
}

export function normaliseManagedSources(values: unknown): ManagedJobSource[] {
  const rows = Array.isArray(values) ? values : [];
  const unique = new Map<string, ManagedJobSource>();
  for (const value of rows) {
    const source = parseStoredSource(value);
    if (source) unique.set(source.id, source);
  }
  return [...unique.values()]
    .slice(0, MAX_SOURCES)
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

export function upsertManagedSource(
  current: ManagedJobSource[],
  input: ManagedJobSourceInput,
  now = new Date().toISOString()
): ManagedJobSource[] {
  const source = validateManagedJobSource(input);
  const id = sourceId(source.type, source.slug);
  const existing = current.find((item) => item.id === id);
  if (!existing && current.length >= MAX_SOURCES) throw new Error(`A maximum of ${MAX_SOURCES} free sources can be active in this registry.`);
  return normaliseManagedSources([
    ...current.filter((item) => item.id !== id),
    {
      ...source,
      id,
      enabled: existing?.enabled ?? true,
      builtIn: existing?.builtIn ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
  ]);
}

export function setManagedSourceEnabled(
  current: ManagedJobSource[],
  id: string,
  enabled: boolean,
  now = new Date().toISOString()
): ManagedJobSource[] {
  if (!current.some((source) => source.id === id)) throw new Error("Job source was not found.");
  return normaliseManagedSources(current.map((source) => source.id === id
    ? { ...source, enabled, updatedAt: now }
    : source));
}

export function removeManagedSource(current: ManagedJobSource[], id: string): ManagedJobSource[] {
  const source = current.find((item) => item.id === id);
  if (!source) throw new Error("Job source was not found.");
  if (source.builtIn) throw new Error("Starter sources can be switched off but cannot be deleted.");
  return current.filter((item) => item.id !== id);
}

export async function loadManagedJobSources(
  client: SupabaseClient = getSupabaseAdmin()
): Promise<ManagedJobSource[]> {
  const result = await client
    .from("moderation_logs")
    .select("summary")
    .eq("run_type", REGISTRY_RUN_TYPE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(`Unable to load the free source registry: ${result.error.message}`);
  const stored = normaliseManagedSources(result.data?.summary?.sources);
  return mergeManagedSourceDefaults(stored);
}

export async function saveManagedJobSources(
  sources: ManagedJobSource[],
  adminEmail: string,
  client: SupabaseClient = getSupabaseAdmin()
): Promise<ManagedJobSource[]> {
  const normalised = normaliseManagedSources(sources);
  if (!normalised.length) throw new Error("At least one free job source must remain configured.");
  const result = await client.from("moderation_logs").insert({
    run_type: REGISTRY_RUN_TYPE,
    summary: {
      action: "snapshot",
      version: 1,
      by: adminEmail,
      enabled: normalised.filter((source) => source.enabled).length,
      total: normalised.length,
      sources: normalised,
    },
  });
  if (result.error) throw new Error(`Unable to save the free source registry: ${result.error.message}`);
  return normalised;
}

export async function loadEnabledCompanyConfigs(
  client: SupabaseClient = getSupabaseAdmin()
): Promise<CompanyConfig[]> {
  const sources = await loadManagedJobSources(client);
  return sources.filter((source) => source.enabled).map(({ name, type, slug }) => ({ name, type: type as ATSType, slug }));
}
