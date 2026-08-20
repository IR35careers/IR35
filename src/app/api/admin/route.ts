/**
 * Admin API: GET /api/admin?section=stats|users|waitlist|jobs|runs
 *            POST /api/admin  { action: "expire_job", jobId }
 *
 * Access requires two server-verified proofs: a live Supabase user token for
 * an allowlisted administrator and a short-lived, signed, HttpOnly admin
 * session cookie. Every mutating action is written to moderation_logs.
 */

import { adminAllowlist, adminSessionCookieName, cookieValue, verifyAdminSession } from "@/lib/admin-session";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(request: Request): Promise<{ id: string; email: string } | Response> {
  const allowlist = adminAllowlist();
  if (allowlist.length === 0) {
    return Response.json({ error: "Secure administration is not configured." }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  const email = user?.email?.toLowerCase();
  if (error || !user || !email || !allowlist.includes(email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = verifyAdminSession(cookieValue(request, adminSessionCookieName()));
  if (!session || session.sub !== user.id || session.email !== email) {
    return Response.json({ error: "Admin session expired. Unlock the admin area again." }, { status: 401 });
  }
  return { id: user.id, email };
}

export async function GET(request: Request): Promise<Response> {
  const admin = await verifyAdmin(request);
  if (admin instanceof Response) return admin;

  const supabase = getSupabaseAdmin();
  const section = new URL(request.url).searchParams.get("section") ?? "stats";

  try {
    if (section === "stats") {
      const [{ count: liveJobs }, { count: expiredJobs }, { count: profiles }, { count: cvs }, { count: waitlist }, usersRes, recentJobs, recentRuns] =
        await Promise.all([
          supabase.from("jobs").select("id", { count: "exact", head: true }).is("expired_at", null),
          supabase.from("jobs").select("id", { count: "exact", head: true }).not("expired_at", "is", null),
          supabase.from("profiles").select("id", { count: "exact", head: true }),
          supabase.from("profiles").select("id", { count: "exact", head: true }).not("cv_path", "is", null),
          supabase.from("waitlist").select("id", { count: "exact", head: true }),
          supabase.auth.admin.listUsers({ page: 1, perPage: 5 }),
          supabase
            .from("jobs")
            .select("id, title, company_name, location, ir35_status, source_domain, rate_min, rate_max, rate_type, first_seen_at, posted_at")
            .is("expired_at", null)
            .order("first_seen_at", { ascending: false })
            .limit(250),
          supabase
            .from("moderation_logs")
            .select("run_type, summary, created_at")
            .order("created_at", { ascending: false })
            .limit(6),
        ]);

      const jobs = recentJobs.data ?? [];
      const statusCounts = jobs.reduce<Record<string, number>>((counts, job) => {
        const status = String(job.ir35_status || "TBC").toLowerCase();
        const key = status.includes("outside") ? "outside" : status.includes("inside") ? "inside" : "tbc";
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, { outside: 0, inside: 0, tbc: 0 });
      const sourceCounts = jobs.reduce<Record<string, number>>((counts, job) => {
        const source = job.source_domain || "Unknown source";
        counts[source] = (counts[source] ?? 0) + 1;
        return counts;
      }, {});
      const topSources = Object.entries(sourceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([source, count]) => ({ source, count }));

      return Response.json({
        totalUsers: (usersRes.data as { total?: number } | null)?.total ?? null,
        profiles: profiles ?? 0,
        cvsUploaded: cvs ?? 0,
        waitlist: waitlist ?? 0,
        liveJobs: liveJobs ?? 0,
        expiredJobs: expiredJobs ?? 0,
        ir35Breakdown: statusCounts,
        topSources,
        recentJobs: jobs.slice(0, 6),
        recentUsers: (usersRes.data?.users ?? []).map((user) => ({
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
        })),
        recentRuns: recentRuns.data ?? [],
        lastPipelineRun: (recentRuns.data ?? []).find((run) => run.run_type === "fetch_jobs") ?? null,
      });
    }

    if (section === "users") {
      const usersRes = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
      const ids = (usersRes.data?.users ?? []).map((u) => u.id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, skills, cv_filename, target_rate_min, preferred_ir35")
        .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
      const users = (usersRes.data?.users ?? []).map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        provider: u.app_metadata?.provider ?? "email",
        profile: profileMap.get(u.id) ?? null,
      }));
      return Response.json({ users, total: (usersRes.data as { total?: number } | null)?.total ?? users.length });
    }

    if (section === "waitlist") {
      const { data } = await supabase
        .from("waitlist")
        .select("email, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      return Response.json({ waitlist: data ?? [] });
    }

    if (section === "jobs") {
      const { data } = await supabase
        .from("jobs")
        .select("id, title, company_name, location, ir35_status, rate_min, rate_max, rate_type, source_domain, posted_at, first_seen_at, expired_at")
        .order("first_seen_at", { ascending: false })
        .limit(50);
      return Response.json({ jobs: data ?? [] });
    }

    if (section === "runs") {
      const { data } = await supabase
        .from("moderation_logs")
        .select("run_type, summary, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      return Response.json({ runs: data ?? [] });
    }

    return Response.json({ error: "Unknown section" }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Admin query failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const admin = await verifyAdmin(request);
  if (admin instanceof Response) return admin;

  const supabase = getSupabaseAdmin();
  try {
    const body = (await request.json()) as { action?: string; jobId?: string };

    if (body.action === "expire_job" && body.jobId) {
      const { error } = await supabase
        .from("jobs")
        .update({ expired_at: new Date().toISOString() })
        .eq("id", body.jobId);
      if (error) throw new Error(error.message);
      await supabase.from("moderation_logs").insert({
        run_type: "admin_action",
        summary: { action: "expire_job", jobId: body.jobId, by: admin.email },
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Admin action failed" },
      { status: 500 }
    );
  }
}
