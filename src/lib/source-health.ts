import { DEMO_JOBS, isDemoDataAvailable } from "@/lib/demo-jobs";
import { supabase } from "@/lib/supabase";

export const SOURCE_STALE_DAYS = 10;
export const SOURCE_FRESH_COVERAGE = 0.6;
const SOURCE_QUERY_LIMIT = 10_000;
const SOURCE_PAGE_SIZE = 1_000;

export type SourceFreshness = "fresh" | "delayed" | "stale" | "unknown";
export type FeedHealthStatus = "healthy" | "mixed" | "stale" | "unavailable";

export interface SourceObservation {
  source_domain: string | null;
  last_seen_at: string | null;
}

export interface SourceHealthItem {
  domain: string;
  label: string;
  activeJobs: number;
  freshJobs: number;
  freshPercent: number;
  lastObservedAt: string | null;
  freshness: SourceFreshness;
  ageDays: number | null;
}

export interface SourceHealthSummary {
  status: FeedHealthStatus;
  activeJobs: number;
  freshJobs: number;
  freshPercent: number;
  sourceCount: number;
  freshSources: number;
  latestObservedAt: string | null;
  staleWindowDays: number;
  generatedAt: string;
  truncated: boolean;
  dataSource: "live" | "demo";
  sources: SourceHealthItem[];
}

function sourceLabel(domain: string): string {
  const normalized = domain.replace(/^www\./, "").toLocaleLowerCase("en-GB");
  const known: Record<string, string> = {
    "reed.co.uk": "Reed",
    "adzuna.co.uk": "Adzuna",
    "adzuna.com": "Adzuna",
    "boards.greenhouse.io": "Greenhouse",
    "jobs.lever.co": "Lever",
    "jobs.ashbyhq.com": "Ashby",
    "apply.workable.com": "Workable",
    "demo.ir35careers.local": "Labelled preview data",
  };
  return known[normalized] ?? normalized.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function observationAge(value: string | null, nowMs: number): { ageDays: number | null; freshness: SourceFreshness } {
  if (!value) return { ageDays: null, freshness: "unknown" };
  const observedMs = new Date(value).getTime();
  if (!Number.isFinite(observedMs)) return { ageDays: null, freshness: "unknown" };
  const ageDays = Math.max(0, Math.floor((nowMs - observedMs) / 86_400_000));
  if (ageDays <= 2) return { ageDays, freshness: "fresh" };
  if (ageDays < SOURCE_STALE_DAYS) return { ageDays, freshness: "delayed" };
  return { ageDays, freshness: "stale" };
}

export function buildSourceHealthSummary(
  rows: SourceObservation[],
  options: { now?: Date; dataSource?: "live" | "demo"; truncated?: boolean } = {}
): SourceHealthSummary {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const grouped = new Map<string, { count: number; freshCount: number; latestMs: number | null; latest: string | null }>();

  for (const row of rows) {
    const domain = row.source_domain?.trim().replace(/^www\./, "") || "source unavailable";
    const observedMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : NaN;
    const current = grouped.get(domain) ?? { count: 0, freshCount: 0, latestMs: null, latest: null };
    current.count += 1;
    if (Number.isFinite(observedMs) && observationAge(row.last_seen_at, nowMs).freshness === "fresh") {
      current.freshCount += 1;
    }
    if (Number.isFinite(observedMs) && (current.latestMs === null || observedMs > current.latestMs)) {
      current.latestMs = observedMs;
      current.latest = row.last_seen_at;
    }
    grouped.set(domain, current);
  }

  const sources = [...grouped.entries()]
    .map(([domain, value]): SourceHealthItem => {
      const age = observationAge(value.latest, nowMs);
      const freshPercent = value.count > 0 ? Math.round((value.freshCount / value.count) * 100) : 0;
      const freshness =
        age.freshness === "fresh" && value.freshCount / value.count < SOURCE_FRESH_COVERAGE
          ? "delayed"
          : age.freshness;
      return {
        domain,
        label: sourceLabel(domain),
        activeJobs: value.count,
        freshJobs: value.freshCount,
        freshPercent,
        lastObservedAt: value.latest,
        freshness,
        ageDays: age.ageDays,
      };
    })
    .sort((a, b) => b.activeJobs - a.activeJobs || a.label.localeCompare(b.label));

  const knownSources = sources.filter((source) => source.freshness !== "unknown");
  const freshSources = sources.filter((source) => source.freshness === "fresh").length;
  const freshJobs = sources.reduce((count, source) => count + source.freshJobs, 0);
  const freshPercent = rows.length > 0 ? Math.round((freshJobs / rows.length) * 100) : 0;
  const latestObservedAt = sources.reduce<string | null>((latest, source) => {
    if (!source.lastObservedAt) return latest;
    if (!latest || new Date(source.lastObservedAt).getTime() > new Date(latest).getTime()) return source.lastObservedAt;
    return latest;
  }, null);

  let status: FeedHealthStatus = "unavailable";
  if (rows.length > 0 && knownSources.length > 0) {
    if (knownSources.every((source) => source.freshness === "fresh")) status = "healthy";
    else if (knownSources.every((source) => source.freshness === "stale")) status = "stale";
    else status = "mixed";
  }

  return {
    status,
    activeJobs: rows.length,
    freshJobs,
    freshPercent,
    sourceCount: sources.length,
    freshSources,
    latestObservedAt,
    staleWindowDays: SOURCE_STALE_DAYS,
    generatedAt: now.toISOString(),
    truncated: options.truncated ?? false,
    dataSource: options.dataSource ?? "live",
    sources,
  };
}

export async function getPublicSourceHealth(): Promise<SourceHealthSummary> {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!configured && isDemoDataAvailable()) {
    return buildSourceHealthSummary(
      DEMO_JOBS.map((job) => ({ source_domain: job.source_domain, last_seen_at: job.last_seen_at ?? job.first_seen_at })),
      { dataSource: "demo" }
    );
  }

  const firstPage = await supabase
    .from("jobs")
    .select("id, source_domain, last_seen_at", { count: "exact" })
    .is("expired_at", null)
    .order("id", { ascending: true })
    .range(0, SOURCE_PAGE_SIZE - 1);
  if (firstPage.error) throw new Error("Public source health is temporarily unavailable.");

  const total = firstPage.count ?? firstPage.data?.length ?? 0;
  const pages = Math.min(Math.ceil(total / SOURCE_PAGE_SIZE), SOURCE_QUERY_LIMIT / SOURCE_PAGE_SIZE);
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, index) => {
      const from = (index + 1) * SOURCE_PAGE_SIZE;
      return supabase
        .from("jobs")
        .select("id, source_domain, last_seen_at")
        .is("expired_at", null)
        .order("id", { ascending: true })
        .range(from, from + SOURCE_PAGE_SIZE - 1);
    })
  );
  if (remaining.some((page) => page.error)) throw new Error("Public source health is temporarily unavailable.");

  const rows = [
    ...((firstPage.data ?? []) as SourceObservation[]),
    ...remaining.flatMap((page) => (page.data ?? []) as SourceObservation[]),
  ].slice(0, SOURCE_QUERY_LIMIT);
  return buildSourceHealthSummary(rows, {
    dataSource: "live",
    truncated: total > SOURCE_QUERY_LIMIT,
  });
}
