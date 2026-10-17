import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobDetail } from "@/lib/job-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { loadManagedJobSources, type ManagedJobSource } from "@/lib/ats/source-registry";

export interface EmployerApplicationDestination {
  sourceId: string;
  email: string;
  enabled: boolean;
  verifiedAt: string;
  updatedAt: string;
}

export interface ResolvedEmployerDestination extends EmployerApplicationDestination {
  source: ManagedJobSource;
}

const DESTINATION_RUN_TYPE = "employer_application_destinations";

export function validRecruitmentEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  return email.length <= 254
    && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
    && !email.endsWith("@example.com");
}

function parseDestination(value: unknown): EmployerApplicationDestination | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const sourceId = typeof row.sourceId === "string" ? row.sourceId.trim().slice(0, 220) : "";
  const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
  const verifiedAt = typeof row.verifiedAt === "string" ? row.verifiedAt : "";
  const updatedAt = typeof row.updatedAt === "string" ? row.updatedAt : verifiedAt;
  if (!sourceId || !validRecruitmentEmail(email) || !Number.isFinite(new Date(verifiedAt).getTime())) return null;
  return { sourceId, email, enabled: row.enabled !== false, verifiedAt, updatedAt };
}

export function normaliseEmployerDestinations(values: unknown): EmployerApplicationDestination[] {
  const rows = Array.isArray(values) ? values : [];
  const unique = new Map<string, EmployerApplicationDestination>();
  for (const value of rows) {
    const destination = parseDestination(value);
    if (destination) unique.set(destination.sourceId, destination);
  }
  return [...unique.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

export async function loadEmployerDestinations(
  client: SupabaseClient = getSupabaseAdmin()
): Promise<EmployerApplicationDestination[]> {
  const result = await client
    .from("moderation_logs")
    .select("summary")
    .eq("run_type", DESTINATION_RUN_TYPE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(`Unable to load employer application destinations: ${result.error.message}`);
  return normaliseEmployerDestinations(result.data?.summary?.destinations);
}

export async function saveEmployerDestination(
  destination: EmployerApplicationDestination,
  actor: string,
  client: SupabaseClient = getSupabaseAdmin()
): Promise<EmployerApplicationDestination[]> {
  const current = await loadEmployerDestinations(client);
  const destinations = normaliseEmployerDestinations([
    ...current.filter((item) => item.sourceId !== destination.sourceId),
    destination,
  ]);
  const result = await client.from("moderation_logs").insert({
    run_type: DESTINATION_RUN_TYPE,
    summary: {
      action: "snapshot",
      version: 1,
      by: actor,
      destinations,
    },
  });
  if (result.error) throw new Error(`Unable to save employer application destination: ${result.error.message}`);
  return destinations;
}

function normaliseCompany(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function resolveEmployerDestinationForJob(
  job: Pick<JobDetail, "id" | "company_name">,
  client: SupabaseClient = getSupabaseAdmin()
): Promise<ResolvedEmployerDestination | null> {
  const [jobResult, sources, destinations] = await Promise.all([
    client.from("jobs").select("source_type, company_name").eq("id", job.id).maybeSingle(),
    loadManagedJobSources(client),
    loadEmployerDestinations(client),
  ]);
  if (jobResult.error) throw new Error(jobResult.error.message);
  const sourceType = String(jobResult.data?.source_type ?? "").toLowerCase();
  const companyName = normaliseCompany(String(jobResult.data?.company_name ?? job.company_name));
  const source = sources.find((item) => item.enabled && item.type === sourceType && normaliseCompany(item.name) === companyName);
  if (!source) return null;
  const destination = destinations.find((item) => item.sourceId === source.id && item.enabled);
  return destination ? { ...destination, source } : null;
}
