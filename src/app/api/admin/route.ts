/**
 * Admin API: GET /api/admin?section=stats|analytics|users|waitlist|campaigns|jobs|runs
 *            POST /api/admin  { action: "expire_job", jobId }
 *                              { action: "send_beta_launch", confirmation }
 *                              { action: "preview_email_campaign", draft }
 *                              { action: "send_email_campaign_test", draft }
 *                              { action: "send_email_campaign", draft, audience, confirmation }
 *
 * Access requires two server-verified proofs: a live Supabase user token for
 * an allowlisted administrator and a short-lived, signed, HttpOnly admin
 * session cookie. Every mutating action is written to moderation_logs.
 */

import type { User } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { adminAllowlist, adminSessionCookieName, cookieValue, verifyAdminSession } from "@/lib/admin-session";
import {
  emailCampaignTemplates,
  renderCampaignEmail,
  validateCampaignDraft,
  type CampaignAudience,
  type EmailCampaignDraft,
} from "@/lib/email/campaigns";
import { planLaunchAudience, type LaunchAudienceRow } from "@/lib/email/launch-audience";
import { renderBetaLaunchEmail } from "@/lib/email/templates";
import { getTransactionalResend, transactionalEmailConfig } from "@/lib/email/transactional";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LAUNCH_CONFIRMATION = "SEND_BETA_ACCESS_2026_08_21";
const CAMPAIGN_CONFIRMATION = "SEND_EMAIL_CAMPAIGN";

type CampaignRecipient = {
  email: string;
  name?: string | null;
  userId?: string;
  createdAt?: string;
  lastSignInAt?: string | null;
};

type CampaignAudienceSets = Record<Exclude<CampaignAudience, "custom">, CampaignRecipient[]>;

function validCampaignEmail(value: unknown): value is string {
  return typeof value === "string"
    && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim())
    && !value.trim().toLowerCase().endsWith("@example.com");
}

function uniqueRecipients(recipients: CampaignRecipient[]): CampaignRecipient[] {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const email = recipient.email.trim().toLowerCase();
    if (!validCampaignEmail(email) || seen.has(email)) return false;
    seen.add(email);
    recipient.email = email;
    return true;
  });
}

async function loadCampaignAudienceSets(client: ReturnType<typeof getSupabaseAdmin>): Promise<CampaignAudienceSets> {
  const users = await listAllUsers(client);
  const registered = users.flatMap((user) => user.email ? [{
    email: user.email,
    name: String(user.user_metadata?.full_name || user.user_metadata?.name || "").trim() || null,
    userId: user.id,
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at,
  }] : []);
  const userIds = users.map((user) => user.id);
  const [profilesResult, waitlistResult] = await Promise.all([
    client.from("profiles").select("id, cv_path").in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]),
    client.from("waitlist").select("email").order("created_at", { ascending: true }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (waitlistResult.error) throw waitlistResult.error;
  const cvUserIds = new Set((profilesResult.data ?? []).filter((profile) => profile.cv_path).map((profile) => profile.id));
  const waitlist = (waitlistResult.data ?? []).flatMap((row) => validCampaignEmail(row.email) ? [{ email: row.email }] : []);
  const inactiveThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const cleanRegistered = uniqueRecipients(registered);
  return {
    registered: cleanRegistered,
    registered_with_cv: cleanRegistered.filter((recipient) => recipient.userId && cvUserIds.has(recipient.userId)),
    registered_without_cv: cleanRegistered.filter((recipient) => !recipient.userId || !cvUserIds.has(recipient.userId)),
    inactive_30d: cleanRegistered.filter((recipient) => new Date(recipient.lastSignInAt || recipient.createdAt || 0).getTime() < inactiveThreshold),
    waitlist: uniqueRecipients(waitlist),
    all: uniqueRecipients([...cleanRegistered, ...waitlist]),
  };
}

async function resolveCampaignAudience(
  client: ReturnType<typeof getSupabaseAdmin>,
  audience: CampaignAudience,
  customEmail?: string
): Promise<CampaignRecipient[]> {
  if (audience === "custom") {
    if (!validCampaignEmail(customEmail)) throw new Error("Enter a valid recipient email address.");
    return [{ email: customEmail.trim().toLowerCase() }];
  }
  const sets = await loadCampaignAudienceSets(client);
  return sets[audience];
}

function campaignAudienceReason(audience: CampaignAudience): string {
  if (audience === "waitlist") return "you joined the IR35Careers waitlist";
  if (audience === "all") return "you registered for or requested access to IR35Careers";
  if (audience === "custom") return "IR35Careers sent this message directly to this address";
  return "you have an IR35Careers account";
}

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

    if (section === "analytics") {
      const users = await listAllUsers(supabase);
      const [
        profilesResult,
        cvsResult,
        savedJobsResult,
        alertsResult,
        resumeVersionsResult,
        packetsResult,
        submissionsResult,
        messagesResult,
        campaignsResult,
      ] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).not("cv_path", "is", null),
        supabase.from("saved_jobs").select("id", { count: "exact", head: true }),
        supabase.from("job_alerts").select("id", { count: "exact", head: true }),
        supabase.from("resume_versions").select("id", { count: "exact", head: true }),
        supabase.from("application_packets").select("status").limit(5000),
        supabase.from("application_submissions").select("status").limit(5000),
        supabase.from("inbox_messages").select("id", { count: "exact", head: true }),
        supabase.from("moderation_logs").select("summary, created_at").eq("run_type", "email_campaign").order("created_at", { ascending: false }).limit(500),
      ]);

      const now = Date.now();
      const signupCounts = new Map<string, number>();
      const signupSeries = Array.from({ length: 14 }, (_, index) => {
        const date = new Date(now - (13 - index) * 24 * 60 * 60 * 1000);
        const key = date.toISOString().slice(0, 10);
        signupCounts.set(key, 0);
        return { date: key, label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date), count: 0 };
      });
      for (const user of users) {
        const key = user.created_at?.slice(0, 10);
        if (key && signupCounts.has(key)) signupCounts.set(key, (signupCounts.get(key) ?? 0) + 1);
      }
      for (const day of signupSeries) day.count = signupCounts.get(day.date) ?? 0;

      const applicationStages = (packetsResult.data ?? []).reduce<Record<string, number>>((stages, packet) => {
        const status = String(packet.status || "draft");
        stages[status] = (stages[status] ?? 0) + 1;
        return stages;
      }, {});
      const submissionStages = (submissionsResult.data ?? []).reduce<Record<string, number>>((stages, submission) => {
        const status = String(submission.status || "queued");
        stages[status] = (stages[status] ?? 0) + 1;
        return stages;
      }, {});
      const campaignSends = (campaignsResult.data ?? []).filter((row) => row.summary?.action === "send");
      const campaignAccepted = campaignSends.reduce((total, row) => total + Number(row.summary?.sent ?? 0), 0);
      const campaignFailed = campaignSends.reduce((total, row) => total + Number(row.summary?.failed ?? 0), 0);
      const activeThreshold = now - 7 * 24 * 60 * 60 * 1000;
      const newUserThreshold = now - 30 * 24 * 60 * 60 * 1000;

      return Response.json({
        analytics: {
          totalUsers: users.length,
          activeUsers7d: users.filter((user) => new Date(user.last_sign_in_at || 0).getTime() >= activeThreshold).length,
          newUsers30d: users.filter((user) => new Date(user.created_at || 0).getTime() >= newUserThreshold).length,
          profiles: profilesResult.count ?? 0,
          cvsUploaded: cvsResult.count ?? 0,
          savedJobs: savedJobsResult.count ?? 0,
          alerts: alertsResult.count ?? 0,
          resumeVersions: resumeVersionsResult.count ?? 0,
          applicationPackets: packetsResult.data?.length ?? 0,
          submissions: submissionsResult.data?.length ?? 0,
          inboxMessages: messagesResult.count ?? 0,
          signupSeries,
          applicationStages,
          submissionStages,
          campaignsSent: campaignSends.length,
          campaignAccepted,
          campaignFailed,
        },
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

    if (section === "campaigns") {
      const [audiences, historyResult] = await Promise.all([
        loadCampaignAudienceSets(supabase),
        supabase
          .from("moderation_logs")
          .select("id, summary, created_at")
          .eq("run_type", "email_campaign")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (historyResult.error) throw historyResult.error;
      const emailConfig = transactionalEmailConfig();
      return Response.json({
        emailTemplates: emailCampaignTemplates,
        audienceCounts: {
          registered: audiences.registered.length,
          registered_with_cv: audiences.registered_with_cv.length,
          registered_without_cv: audiences.registered_without_cv.length,
          inactive_30d: audiences.inactive_30d.length,
          waitlist: audiences.waitlist.length,
          all: audiences.all.length,
          custom: 1,
        },
        campaignHistory: historyResult.data ?? [],
        sender: emailConfig?.from ?? null,
        deliveryConfigured: Boolean(emailConfig),
      });
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
    const body = (await request.json()) as {
      action?: string;
      jobId?: string;
      confirmation?: string;
      draft?: Partial<EmailCampaignDraft>;
      audience?: CampaignAudience;
      customEmail?: string;
      campaignId?: string;
    };

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

    if (body.action === "preview_email_campaign") {
      const content = renderCampaignEmail(body.draft ?? {}, {
        recipientName: "Anvesh",
        audienceReason: "this is a secure administrator preview",
      });
      return Response.json(content);
    }

    if (body.action === "send_email_campaign_test") {
      const emailConfig = transactionalEmailConfig();
      if (!emailConfig) return Response.json({ error: "Transactional email delivery is not configured." }, { status: 503 });
      const draft = validateCampaignDraft(body.draft ?? {});
      const content = renderCampaignEmail(draft, {
        recipientName: admin.email.split("@")[0],
        audienceReason: "you requested this administrator test email",
      });
      const delivery = await getTransactionalResend(emailConfig).emails.send({
        from: emailConfig.from,
        to: [admin.email],
        subject: `[TEST] ${content.subject}`,
        html: content.html,
        text: content.text,
        ...(emailConfig.replyTo ? { replyTo: emailConfig.replyTo } : {}),
        tags: [{ name: "email_type", value: "campaign_test" }],
      });
      if (delivery.error || !delivery.data?.id) {
        return Response.json({ error: delivery.error?.message || "Test email delivery failed." }, { status: 503 });
      }
      await supabase.from("moderation_logs").insert({
        run_type: "email_campaign",
        summary: {
          action: "test",
          by: admin.email,
          template_id: draft.templateId,
          subject: draft.subject,
          recipient_count: 1,
          status: "accepted",
          provider_id: delivery.data.id,
        },
      });
      return Response.json({ ok: true, sent: 1, recipient: admin.email }, { status: 201 });
    }

    if (body.action === "send_email_campaign") {
      if (body.confirmation !== CAMPAIGN_CONFIRMATION) {
        return Response.json({ error: "Explicit campaign confirmation is required." }, { status: 400 });
      }
      if (!body.campaignId || !/^[0-9a-f-]{36}$/i.test(body.campaignId)) {
        return Response.json({ error: "A valid campaign identifier is required." }, { status: 400 });
      }
      const audience: CampaignAudience = ["registered", "registered_with_cv", "registered_without_cv", "inactive_30d", "waitlist", "all", "custom"].includes(body.audience ?? "")
        ? body.audience as CampaignAudience
        : "registered";
      const emailConfig = transactionalEmailConfig();
      if (!emailConfig) return Response.json({ error: "Transactional email delivery is not configured." }, { status: 503 });
      const draft = validateCampaignDraft(body.draft ?? {});
      const recipients = await resolveCampaignAudience(supabase, audience, body.customEmail);
      if (!recipients.length) return Response.json({ error: "This audience has no deliverable recipients." }, { status: 400 });
      const fingerprint = createHash("sha256").update(JSON.stringify({
        audience,
        recipients: recipients.map((recipient) => recipient.email).sort(),
        draft,
      })).digest("hex");

      const previous = await supabase
        .from("moderation_logs")
        .select("id, summary")
        .eq("run_type", "email_campaign")
        .contains("summary", { campaign_id: body.campaignId })
        .limit(1)
        .maybeSingle();
      if (previous.error) throw previous.error;
      if (previous.data) {
        return Response.json({ error: "This campaign has already been processed. Start a new draft before sending again." }, { status: 409 });
      }
      const recentDuplicate = await supabase
        .from("moderation_logs")
        .select("id, summary, created_at")
        .eq("run_type", "email_campaign")
        .contains("summary", { fingerprint })
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentDuplicate.error) throw recentDuplicate.error;
      if (recentDuplicate.data && (recentDuplicate.data.summary?.status !== "failed" || Number(recentDuplicate.data.summary?.sent ?? 0) > 0)) {
        return Response.json({ error: "An identical campaign was already processed for this audience in the last 24 hours." }, { status: 409 });
      }

      const auditStart = await supabase.from("moderation_logs").insert({
        run_type: "email_campaign",
        summary: {
          action: "send",
          campaign_id: body.campaignId,
          fingerprint,
          by: admin.email,
          template_id: draft.templateId,
          subject: draft.subject,
          audience,
          recipient_count: recipients.length,
          status: "processing",
        },
      }).select("id").single();
      if (auditStart.error) throw auditStart.error;

      let sent = 0;
      let failed = 0;
      const providerIds: string[] = [];
      const providerErrors: string[] = [];
      for (let offset = 0; offset < recipients.length; offset += 100) {
        const chunk = recipients.slice(offset, offset + 100);
        const delivery = await getTransactionalResend(emailConfig).batch.send(
          chunk.map((recipient) => {
            const content = renderCampaignEmail(draft, {
              recipientName: recipient.name,
              audienceReason: campaignAudienceReason(audience),
            });
            return {
              from: emailConfig.from,
              to: [recipient.email],
              subject: content.subject,
              html: content.html,
              text: content.text,
              ...(emailConfig.replyTo ? { replyTo: emailConfig.replyTo } : {}),
              tags: [
                { name: "email_type", value: "admin_campaign" },
                { name: "template", value: draft.templateId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 50) || "custom" },
              ],
            };
          }),
          {
            idempotencyKey: `ir35careers-campaign-${body.campaignId}-${Math.floor(offset / 100)}`,
            batchValidation: "permissive",
          }
        );
        if (delivery.error || !delivery.data) {
          failed += chunk.length;
          providerErrors.push((delivery.error?.message || "Provider batch failed").slice(0, 200));
          continue;
        }
        sent += delivery.data.data.length;
        failed += delivery.data.errors.length;
        providerIds.push(...delivery.data.data.map((item) => item.id));
        providerErrors.push(...delivery.data.errors.map((item) => item.message.slice(0, 200)));
      }

      const status = failed === 0 ? "accepted" : sent > 0 ? "partial" : "failed";
      const auditUpdate = await supabase.from("moderation_logs").update({
        summary: {
          action: "send",
          campaign_id: body.campaignId,
          fingerprint,
          by: admin.email,
          template_id: draft.templateId,
          subject: draft.subject,
          audience,
          recipient_count: recipients.length,
          sent,
          failed,
          status,
          provider_ids: providerIds,
          provider_errors: providerErrors.slice(0, 20),
        },
      }).eq("id", auditStart.data.id);
      if (auditUpdate.error) throw auditUpdate.error;
      return Response.json({ ok: failed === 0, sent, failed, audience, campaignId: body.campaignId }, { status: failed ? 207 : 201 });
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
