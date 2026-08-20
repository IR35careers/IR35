/**
 * Public job search: GET /api/jobs/search
 *
 * Query params (all optional):
 *   q         free-text search (title, company, description)
 *   ir35      inside | outside | unknown ("tbc" is accepted as an alias)
 *   remote    remote | hybrid | onsite
 *   min_rate  integer — matches jobs whose known rate reaches this figure
 *   location  substring match, e.g. "london"
 *   skills    comma-separated canonical skills, e.g. "React,AWS"
 *   sort      recent (default) | rate_high | rate_low
 *   page      1-based page number (default 1)
 *   per_page  1–50 (default 20)
 *
 * Reads through the anonymous Supabase client — Row Level Security already
 * restricts visibility to active (non-expired) jobs, and this route adds
 * the same filter explicitly for index use.
 */

import { supabase } from "@/lib/supabase";
import { JOB_LIST_COLUMNS } from "@/lib/job-types";
import { DEMO_JOBS, isDemoDataAvailable } from "@/lib/demo-jobs";
import type { JobDetail, JobListing } from "@/lib/job-types";

export const dynamic = "force-dynamic";

const IR35_VALUES = new Set(["inside", "outside", "unknown"]);
const REMOTE_VALUES = new Set(["remote", "hybrid", "onsite"]);
const SORT_VALUES = new Set(["recent", "rate_high", "rate_low"]);

function toPublicListing(job: JobDetail): JobListing {
  return {
    id: job.id,
    title: job.title,
    company_name: job.company_name,
    location: job.location,
    remote_type: job.remote_type,
    ir35_status: job.ir35_status,
    ir35_confidence: job.ir35_confidence,
    rate_min: job.rate_min,
    rate_max: job.rate_max,
    rate_currency: job.rate_currency,
    rate_type: job.rate_type,
    skills: job.skills,
    posted_at: job.posted_at,
    first_seen_at: job.first_seen_at,
    last_seen_at: job.last_seen_at,
    source_domain: job.source_domain,
  };
}

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  const n = value === null ? NaN : parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function searchResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200 ? "public, s-maxage=60, stale-while-revalidate=300" : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const p = url.searchParams;

  const q = (p.get("q") ?? "").slice(0, 100).trim();
  const ir35Param = p.get("ir35") ?? "";
  const ir35 = ir35Param === "tbc" ? "unknown" : ir35Param;
  const remote = p.get("remote") ?? "";
  const location = (p.get("location") ?? "").slice(0, 60).trim();
  const minRate = clampInt(p.get("min_rate"), 0, 10000, 0);
  const skills = (p.get("skills") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  const sort = SORT_VALUES.has(p.get("sort") ?? "") ? (p.get("sort") as string) : "recent";
  const page = clampInt(p.get("page"), 1, 500, 1);
  const perPage = clampInt(p.get("per_page"), 1, 50, 20);

  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  if (!configured && isDemoDataAvailable()) {
    const withinDays = clampInt(p.get("within_days"), 0, 60, 0);
    const queryText = q.toLowerCase();
    let jobs = DEMO_JOBS.filter((job) => {
      const searchable = `${job.title} ${job.company_name} ${job.description} ${job.skills.join(" ")}`.toLowerCase();
      if (queryText && !searchable.includes(queryText)) return false;
      if (IR35_VALUES.has(ir35) && job.ir35_status !== ir35) return false;
      if (REMOTE_VALUES.has(remote) && job.remote_type !== remote) return false;
      if (location && !job.location.toLowerCase().includes(location.toLowerCase())) return false;
      if (skills.length > 0 && !skills.every((skill) => job.skills.includes(skill))) return false;
      if (minRate > 0 && (job.rate_type !== "daily" || Math.max(job.rate_min ?? 0, job.rate_max ?? 0) < minRate)) return false;
      if (withinDays > 0) {
        const date = new Date(job.posted_at ?? job.first_seen_at).getTime();
        if (date < Date.now() - withinDays * 86_400_000) return false;
      }
      return true;
    });

    if (sort === "rate_high" || sort === "rate_low") {
      jobs = jobs.filter((job) => job.rate_type === "daily" && (job.rate_min !== null || job.rate_max !== null));
    }

    jobs = jobs.sort((a, b) => {
      if (sort === "rate_high") return (b.rate_max ?? b.rate_min ?? 0) - (a.rate_max ?? a.rate_min ?? 0);
      if (sort === "rate_low") return (a.rate_min ?? a.rate_max ?? 0) - (b.rate_min ?? b.rate_max ?? 0);
      return new Date(b.posted_at ?? b.first_seen_at).getTime() - new Date(a.posted_at ?? a.first_seen_at).getTime();
    });

    const total = jobs.length;
    const from = (page - 1) * perPage;
    const facets =
      p.get("with_facets") === "1"
        ? {
            outside: DEMO_JOBS.filter((job) => job.ir35_status === "outside").length,
            inside: DEMO_JOBS.filter((job) => job.ir35_status === "inside").length,
            tbc: DEMO_JOBS.filter((job) => job.ir35_status === "unknown").length,
            remote: DEMO_JOBS.filter((job) => job.remote_type === "remote").length,
            hybrid: DEMO_JOBS.filter((job) => job.remote_type === "hybrid").length,
            onsite: DEMO_JOBS.filter((job) => job.remote_type === "onsite").length,
          }
        : undefined;

    return searchResponse({
      jobs: jobs.slice(from, from + perPage).map(toPublicListing),
      total,
      facets,
      page,
      per_page: perPage,
      data_source: "demo",
      generated_at: new Date().toISOString(),
    });
  }

  try {
    let query = supabase
      .from("jobs")
      .select(JOB_LIST_COLUMNS, { count: "exact" })
      .is("expired_at", null);

    if (q) {
      query = query.textSearch("search_vector", q, { type: "websearch", config: "english" });
    }
    if (IR35_VALUES.has(ir35)) query = query.eq("ir35_status", ir35);
    if (REMOTE_VALUES.has(remote)) query = query.eq("remote_type", remote);
    if (location) query = query.ilike("location", `%${location}%`);
    if (skills.length > 0) query = query.contains("skills", skills);
    if (minRate > 0) query = query.eq("rate_type", "daily").or(`rate_min.gte.${minRate},rate_max.gte.${minRate}`);

    // Recency filter: posted within N days.
    const withinDays = clampInt(p.get("within_days"), 0, 60, 0);
    if (withinDays > 0) {
      const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString().slice(0, 10);
      query = query.gte("posted_on", cutoff);
    }

    if (sort === "rate_high") {
      query = query.eq("rate_type", "daily").order("rate_max", { ascending: false, nullsFirst: false });
    } else if (sort === "rate_low") {
      query = query.eq("rate_type", "daily").order("rate_min", { ascending: true, nullsFirst: false });
    } else {
      query = query
        .order("posted_on", { ascending: false, nullsFirst: false })
        .order("posted_at", { ascending: false, nullsFirst: false })
        .order("rate_max", { ascending: false, nullsFirst: false });
    }

    const from = (page - 1) * perPage;
    query = query.range(from, from + perPage - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    // Facet counts for the sidebar — reflect q + location + recency (the
    // non-toggle filters), so each shows "how many match my search".
    let facets: Record<string, number> | undefined;
    if (p.get("with_facets") === "1") {
      const withinDays2 = clampInt(p.get("within_days"), 0, 60, 0);
      const cutoff2 = withinDays2 > 0 ? new Date(Date.now() - withinDays2 * 86_400_000).toISOString().slice(0, 10) : null;
      const base = () => {
        let b = supabase.from("jobs").select("id", { count: "exact", head: true }).is("expired_at", null);
        if (q) b = b.textSearch("search_vector", q, { type: "websearch", config: "english" });
        if (location) b = b.ilike("location", `%${location}%`);
        if (cutoff2) b = b.gte("posted_on", cutoff2);
        if (skills.length > 0) b = b.contains("skills", skills);
        if (minRate > 0) b = b.eq("rate_type", "daily").or(`rate_min.gte.${minRate},rate_max.gte.${minRate}`);
        return b;
      };
      const [outside, inside, tbc, remoteC, hybridC, onsiteC] = await Promise.all([
        base().eq("ir35_status", "outside"),
        base().eq("ir35_status", "inside"),
        base().eq("ir35_status", "unknown"),
        base().eq("remote_type", "remote"),
        base().eq("remote_type", "hybrid"),
        base().eq("remote_type", "onsite"),
      ]);
      facets = {
        outside: outside.count ?? 0,
        inside: inside.count ?? 0,
        tbc: tbc.count ?? 0,
        remote: remoteC.count ?? 0,
        hybrid: hybridC.count ?? 0,
        onsite: onsiteC.count ?? 0,
      };
    }

    return searchResponse({
      jobs: data ?? [],
      total: count ?? 0,
      facets,
      page,
      per_page: perPage,
      data_source: "live",
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    return searchResponse(
      { error: err instanceof Error ? err.message : "Search failed" },
      500
    );
  }
}
