/**
 * Public job search: GET /api/jobs/search
 *
 * Query params (all optional):
 *   q         free-text search (title, company, description)
 *   ir35      inside | outside
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

export const dynamic = "force-dynamic";

const IR35_VALUES = new Set(["inside", "outside"]);
const REMOTE_VALUES = new Set(["remote", "hybrid", "onsite"]);
const SORT_VALUES = new Set(["recent", "rate_high", "rate_low"]);

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  const n = value === null ? NaN : parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const p = url.searchParams;

  const q = (p.get("q") ?? "").slice(0, 100).trim();
  const ir35 = p.get("ir35") ?? "";
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
    if (minRate > 0) query = query.or(`rate_min.gte.${minRate},rate_max.gte.${minRate}`);

    // Recency filter: posted within N days.
    const withinDays = clampInt(p.get("within_days"), 0, 60, 0);
    if (withinDays > 0) {
      const cutoff = new Date(Date.now() - withinDays * 86_400_000).toISOString().slice(0, 10);
      query = query.gte("posted_on", cutoff);
    }

    if (sort === "rate_high") {
      query = query.order("rate_max", { ascending: false, nullsFirst: false });
    } else if (sort === "rate_low") {
      query = query.order("rate_min", { ascending: true, nullsFirst: false });
    } else {
      query = query
        .order("posted_on", { ascending: false, nullsFirst: false })
        .order("rate_max", { ascending: false, nullsFirst: false })
        .order("posted_at", { ascending: false, nullsFirst: false });
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

    return Response.json({
      jobs: data ?? [],
      total: count ?? 0,
      facets,
      page,
      per_page: perPage,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
