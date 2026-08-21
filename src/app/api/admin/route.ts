/**
 * Admin API: GET /api/admin?section=stats|users|waitlist|jobs|runs
 *            POST /api/admin  { action: "expire_job", jobId }
 *                              { action: "send_beta_launch", confirmation }
 *
 * Access requires two server-verified proofs: a live Supabase user token for
 * an allowlisted administrator and a short-lived, signed, HttpOnly admin
 * session cookie. Every mutating action is written to moderation_logs.
 */

import type { User } from "@supabase/supabase-js";
import { adminAllowlist, adminSessionCookieName, cookieValue, verifyAdminSession } from "@/lib/admin-session";
import { planLaunchAudience, type LaunchAudienceRow } from "@/lib/email/launch-audience";
import { renderBetaLaunchEmail } from "@/lib/email/templates";
import { getTransactionalResend, transactionalEmailConfig } from "@/lib/email/transactional";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LAUNCH_CONFIRMATION = "SEND_BETA_ACCESS_2026_08_21";

async function listAllUsers(client: ReturnType<typeof getSupabaseAdmin>): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page += 1) {
    const result = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    users.push(...result.data.users);
    if (result.data.users.length < 1000) return users;
  }
}

async function correctAuthEmail(
  client: ReturnType<typeof getSupabaseAdmin>,
  users: User[],
  sourceEmail: string,
  targetEmail: string
): Promise<"not_found" | "updated" | "duplicate_removed"> {
  const source = users.find((user) => user.email?.toLowerCase() === sourceEmail);
  if (!source) return "not_found";
  const target = users.find((user) => user.email?.toLowerCase() === targetEmail);
  if (target && target.id !== source.id) {
    const result = await client.auth.admin.deleteUser(source.id);
    if (result.error) throw result.error;
    return "duplicate_removed";
  }
  const result = await client.auth.admin.updateUserById(source.id, {
    email: targetEmail,
    email_confirm: true,
  });
  if (result.error) throw result.error;
  return "updated";
}

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
        .select("id, email, created_at, launch_notified_at, launch_email_id, launch_email_attempts, launch_last_error")
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
    const body = (await request.json()) as { action?: string; jobId?: string; confirmation?: string };

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

    if (body.action === "send_beta_launch") {
      if (body.confirmation !== LAUNCH_CONFIRMATION) {
        return Response.json({ error: "Explicit launch confirmation is required." }, { status: 400 });
      }
      if ((process.env.ENABLE_WAITLIST_LAUNCH_EMAIL ?? "").trim().toLowerCase() !== "true") {
        return Response.json({ error: "Beta invitation delivery is not enabled." }, { status: 503 });
      }
      const emailConfig = transactionalEmailConfig();
      if (!emailConfig) {
        return Response.json({ error: "Transactional email delivery is not configured." }, { status: 503 });
      }

      const waitlistResult = await supabase
        .from("waitlist")
        .select("id, email, created_at, launch_notified_at, launch_email_id, launch_email_attempts, launch_last_error")
        .order("created_at", { ascending: true });
      if (waitlistResult.error) throw waitlistResult.error;
      const waitlist = (waitlistResult.data ?? []) as LaunchAudienceRow[];

      const initialUsers = await listAllUsers(supabase);
      const accountCorrections = {
        misspelledDuplicate: await correctAuthEmail(
          supabase,
          initialUsers,
          "mannuru.anvesh@gmial.com",
          "mannuru.anvesh@gmail.com"
        ),
        brittanAddress: await correctAuthEmail(
          supabase,
          initialUsers,
          "chris@brittan.co",
          "chris@brittan.com"
        ),
      };

      const correctedUsers = await listAllUsers(supabase);
      const registeredEmails = correctedUsers.flatMap((user) => user.email ? [user.email] : []);
      const plan = planLaunchAudience(waitlist, registeredEmails);
      const cleanupIds = [...plan.duplicateRows, ...plan.invalidRows].map((row) => row.id);
      if (cleanupIds.length) {
        const cleanup = await supabase.from("waitlist").delete().in("id", cleanupIds);
        if (cleanup.error) throw cleanup.error;
      }

      if (plan.recipients.length === 0) {
        await supabase.from("moderation_logs").insert({
          run_type: "admin_action",
          summary: {
            action: "send_beta_launch",
            by: admin.email,
            sent: 0,
            already_notified: plan.alreadyNotifiedRows.length,
            duplicate_waitlist_removed: plan.duplicateRows.length,
            invalid_waitlist_removed: plan.invalidRows.length,
            account_corrections: accountCorrections,
          },
        });
        return Response.json({
          ok: true,
          sent: 0,
          failed: 0,
          alreadyNotified: plan.alreadyNotifiedRows.length,
          duplicateWaitlistRemoved: plan.duplicateRows.length,
          invalidWaitlistRemoved: plan.invalidRows.length,
          accountCorrections,
        });
      }

      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.ir35careers.com").replace(/\/$/, "");
      const content = renderBetaLaunchEmail({ siteUrl });
      const delivery = await getTransactionalResend(emailConfig).batch.send(
        plan.recipients.map((recipient) => ({
          from: emailConfig.from,
          to: [recipient.email],
          subject: content.subject,
          html: content.html,
          text: content.text,
          ...(emailConfig.replyTo ? { replyTo: emailConfig.replyTo } : {}),
          tags: [{ name: "email_type", value: "beta_launch" }],
        })),
        {
          idempotencyKey: "ir35careers-public-beta-2026-08-21-v1",
          batchValidation: "permissive",
        }
      );

      if (delivery.error || !delivery.data) {
        const message = delivery.error?.message || "Resend batch delivery failed";
        for (const recipient of plan.recipients) {
          await supabase.from("waitlist").update({
            launch_email_attempts: Number(recipient.launch_email_attempts ?? 0) + 1,
            launch_last_error: message.slice(0, 500),
          }).eq("id", recipient.id);
        }
        await supabase.from("moderation_logs").insert({
          run_type: "admin_action",
          summary: {
            action: "send_beta_launch",
            by: admin.email,
            sent: 0,
            failed: plan.recipients.length,
            provider_error: message.slice(0, 200),
            duplicate_waitlist_removed: plan.duplicateRows.length,
            invalid_waitlist_removed: plan.invalidRows.length,
            account_corrections: accountCorrections,
          },
        });
        return Response.json({ error: "The cleaned audience was saved, but email delivery failed." }, { status: 503 });
      }

      const errorsByIndex = new Map((delivery.data.errors ?? []).map((item) => [item.index, item.message]));
      let successCursor = 0;
      let sent = 0;
      let failed = 0;
      let ledgerErrors = 0;
      const sentAt = new Date().toISOString();
      for (let index = 0; index < plan.recipients.length; index += 1) {
        const recipient = plan.recipients[index];
        const providerError = errorsByIndex.get(index);
        const emailId = providerError ? null : delivery.data.data[successCursor++]?.id ?? null;
        const update = providerError || !emailId
          ? {
              launch_email_attempts: Number(recipient.launch_email_attempts ?? 0) + 1,
              launch_last_error: (providerError || "Provider did not return a delivery ID").slice(0, 500),
            }
          : {
              launch_notified_at: sentAt,
              launch_email_id: emailId,
              launch_email_attempts: Number(recipient.launch_email_attempts ?? 0) + 1,
              launch_last_error: null,
            };
        const ledger = await supabase.from("waitlist").update(update).eq("id", recipient.id);
        if (ledger.error) ledgerErrors += 1;
        if (providerError || !emailId) failed += 1;
        else sent += 1;
      }

      await supabase.from("moderation_logs").insert({
        run_type: "admin_action",
        summary: {
          action: "send_beta_launch",
          by: admin.email,
          sent,
          failed,
          ledger_errors: ledgerErrors,
          duplicate_waitlist_removed: plan.duplicateRows.length,
          invalid_waitlist_removed: plan.invalidRows.length,
          account_corrections: accountCorrections,
        },
      });

      return Response.json({
        ok: failed === 0 && ledgerErrors === 0,
        sent,
        failed,
        ledgerErrors,
        alreadyNotified: plan.alreadyNotifiedRows.length,
        duplicateWaitlistRemoved: plan.duplicateRows.length,
        invalidWaitlistRemoved: plan.invalidRows.length,
        accountCorrections,
      }, { status: failed || ledgerErrors ? 207 : 201 });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Admin action failed" },
      { status: 500 }
    );
  }
}
