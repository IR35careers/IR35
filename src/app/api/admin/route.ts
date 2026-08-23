/**
 * Admin API: GET /api/admin?section=stats|analytics|users|feedback|waitlist|campaigns|jobs|runs|system
 *            POST /api/admin  { action: "expire_job", jobId }
 *                              { action: "send_beta_launch", confirmation }
 *                              { action: "preview_email_campaign", draft }
 *                              { action: "send_email_campaign_test", draft }
 *                              { action: "send_email_campaign", draft, audience, confirmation }
 *                              { action: "update_feedback_status", feedbackId, feedbackStatus }
 *
 * Access requires two server-verified proofs: a live Supabase user token for
 * an allowlisted administrator and a short-lived, signed, HttpOnly admin
 * session cookie. Every mutating action is written to moderation_logs.
 */

import type { User } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { adminAllowlist, adminSessionCookieName, cookieValue, isAdminRequestHost, verifyAdminSession } from "@/lib/admin-session";
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
import { sendFeedbackEmail } from "@/lib/email/feedback-notifications";
import { fetchCompany } from "@/lib/ats";
import { HttpClient } from "@/lib/ats/http-client";
import {
  FREE_ATS_TYPES,
  loadManagedJobSources,
  removeManagedSource,
  saveManagedJobSources,
  setManagedSourceEnabled,
  upsertManagedSource,
  validateManagedJobSource,
} from "@/lib/ats/source-registry";
import { runFetchPipeline } from "@/lib/pipeline/run-fetch";
import { buildApplicationAttention } from "@/lib/application-attention";
import {
  loadEmployerDestinations,
  saveEmployerDestination,
  validRecruitmentEmail,
} from "@/lib/employer-destinations";
import { requestEmployerDestinationVerification } from "@/lib/employer-onboarding";
import { getIntegrationStatuses } from "@/lib/integration-status";
import { applicationWorkerConfig } from "@/lib/application-worker-auth";
import { createApplicationRunnerTestToken } from "@/lib/application-runner/test-token";
import { providerReviewQuestions } from "@/lib/application-submission";
import { SUBMISSION_LOCK_MAX_AGE_MS } from "@/lib/application-submission-state";
import {
  runInboundEmailLoopAudit,
} from "@/lib/inbound-email-loop-audit";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { SAMPLE_CONTRACTOR_PROFILE } from "@/lib/workspace/seed";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { enrichFeedback, feedbackSummary, type FeedbackRecord, type FeedbackStatus } from "@/lib/admin-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LAUNCH_CONFIRMATION = "SEND_BETA_ACCESS_2026_08_21";
const CAMPAIGN_CONFIRMATION = "SEND_EMAIL_CAMPAIGN";
const FEEDBACK_BUCKET = "feedback-attachments";

async function feedbackSignedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const signed = await getSupabaseAdmin().storage.from(FEEDBACK_BUCKET).createSignedUrl(path, 60 * 60);
  return signed.data?.signedUrl ?? null;
}

async function presentAdminFeedback(record: FeedbackRecord): Promise<FeedbackRecord> {
  const messages = await Promise.all((record.messages ?? []).map(async (message) => ({
    ...message,
    attachment_url: await feedbackSignedUrl(message.attachment_path),
  })));
  return { ...record, attachment_url: await feedbackSignedUrl(record.attachment_path), messages };
}

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
  if (!isAdminRequestHost(request)) return Response.json({ error: "Not found." }, { status: 404 });
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
        supabase.from("application_submissions").select("status, error_code").limit(5000),
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
        const status = submission.error_code === "needs_user" ? "needs_user" : String(submission.status || "queued");
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
      const authUsers = await listAllUsers(supabase);
      const ids = authUsers.map((user) => user.id);
      const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
      const [profilesResult, packetsResult, savedJobsResult, resumeVersionsResult, alertsResult, messagesResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, phone, linkedin_url, job_title, years_experience, skills, cv_filename, target_rate_min, preferred_ir35, preferred_remote, application_profile, created_at, updated_at")
          .in("id", safeIds),
        supabase.from("application_packets").select("user_id, status, updated_at").in("user_id", safeIds),
        supabase.from("saved_jobs").select("user_id, status, created_at").in("user_id", safeIds),
        supabase.from("resume_versions").select("user_id, created_at").in("user_id", safeIds),
        supabase.from("job_alerts").select("user_id, created_at").in("user_id", safeIds),
        supabase.from("inbox_messages").select("user_id, is_read, received_at").in("user_id", safeIds),
      ]);
      for (const result of [profilesResult, packetsResult, savedJobsResult, resumeVersionsResult, alertsResult, messagesResult]) {
        if (result.error) throw result.error;
      }
      const profileMap = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
      const activityMap = new Map<string, {
        applications: number;
        applied: number;
        needsAttention: number;
        savedJobs: number;
        resumeVersions: number;
        alerts: number;
        inboxMessages: number;
        unreadMessages: number;
        latestApplicationAt: string | null;
      }>();
      const activityFor = (userId: string) => {
        const existing = activityMap.get(userId);
        if (existing) return existing;
        const created = { applications: 0, applied: 0, needsAttention: 0, savedJobs: 0, resumeVersions: 0, alerts: 0, inboxMessages: 0, unreadMessages: 0, latestApplicationAt: null };
        activityMap.set(userId, created);
        return created;
      };
      for (const packet of packetsResult.data ?? []) {
        const activity = activityFor(packet.user_id);
        activity.applications += 1;
        if (["applied", "viewed", "replied", "interview", "offer"].includes(String(packet.status))) activity.applied += 1;
        if (packet.status === "needs_review") activity.needsAttention += 1;
        if (!activity.latestApplicationAt || packet.updated_at > activity.latestApplicationAt) activity.latestApplicationAt = packet.updated_at;
      }
      for (const saved of savedJobsResult.data ?? []) activityFor(saved.user_id).savedJobs += 1;
      for (const version of resumeVersionsResult.data ?? []) activityFor(version.user_id).resumeVersions += 1;
      for (const alert of alertsResult.data ?? []) activityFor(alert.user_id).alerts += 1;
      for (const message of messagesResult.data ?? []) {
        const activity = activityFor(message.user_id);
        activity.inboxMessages += 1;
        if (!message.is_read) activity.unreadMessages += 1;
      }
      const users = authUsers.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        email_confirmed_at: u.email_confirmed_at,
        updated_at: u.updated_at,
        banned_until: u.banned_until,
        provider: u.app_metadata?.provider ?? "email",
        profile: profileMap.get(u.id) ?? null,
        activity: activityFor(u.id),
      }));
      return Response.json({ users, total: users.length });
    }

    if (section === "feedback") {
      const feedbackResult = await supabase
        .from("contact_requests")
        .select("id, user_id, name, email, company, subject, message, status, category, page_url, browser_context, attachment_path, resolution_summary, acknowledged_at, resolved_at, created_at, updated_at, messages:feedback_messages(id, feedback_id, author_type, author_user_id, author_email, message, attachment_path, created_at, read_by_user_at)")
        .order("updated_at", { ascending: false })
        .order("created_at", { referencedTable: "feedback_messages", ascending: true })
        .limit(500);
      if (feedbackResult.error) throw feedbackResult.error;
      const feedback = await Promise.all((feedbackResult.data ?? []).map((row) => presentAdminFeedback(enrichFeedback({
        ...row as unknown as FeedbackRecord,
        status: row.status as FeedbackStatus,
      }))));
      return Response.json({ feedback, feedbackSummary: feedbackSummary(feedback) });
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

    if (section === "sources") {
      const [sources, destinations, lastRunResult, employerVerificationResult] = await Promise.all([
        loadManagedJobSources(supabase),
        loadEmployerDestinations(supabase),
        supabase
          .from("moderation_logs")
          .select("run_type, summary, created_at")
          .eq("run_type", "fetch_jobs")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("moderation_logs")
          .select("id, summary, created_at")
          .eq("run_type", "employer_destination_verification")
          .order("created_at", { ascending: false })
          .limit(250),
      ]);
      if (lastRunResult.error || employerVerificationResult.error) throw lastRunResult.error || employerVerificationResult.error;
      const verificationLogs = employerVerificationResult.data ?? [];
      const resolvedRequestIds = new Set(verificationLogs.flatMap((row) => {
        const summary = row.summary as Record<string, unknown> | null;
        const action = String(summary?.action ?? "");
        const requestId = String(summary?.request_log_id ?? "");
        return requestId && (action === "verified" || action === "rejected") ? [requestId] : [];
      }));
      const pendingEmployerConnections = verificationLogs.flatMap((row) => {
        const summary = row.summary as Record<string, unknown> | null;
        const requestId = String(summary?.request_log_id ?? "");
        if (summary?.action !== "employer_confirmed" || !requestId || resolvedRequestIds.has(requestId)) return [];
        const email = String(summary.email ?? "").trim().toLowerCase();
        const sourceId = String(summary.source_id ?? "").trim();
        if (!validRecruitmentEmail(email) || !sources.some((source) => source.id === sourceId)) return [];
        return [{
          id: row.id,
          requestLogId: requestId,
          sourceId,
          sourceName: String(summary.source_name ?? "Employer").slice(0, 100),
          email,
          confirmedAt: String(summary.confirmed_at ?? row.created_at),
        }];
      });
      return Response.json({
        jobSources: sources.map((source) => {
          const destination = destinations.find((item) => item.sourceId === source.id && item.enabled);
          return {
            ...source,
            directApplyConnected: Boolean(destination),
            directApplyEmail: destination?.email ?? null,
            directApplyVerifiedAt: destination?.verifiedAt ?? null,
          };
        }),
        sourceProviders: FREE_ATS_TYPES,
        lastPipelineRun: lastRunResult.data ?? null,
        pendingEmployerConnections,
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

    if (section === "system") {
      const workerConfig = applicationWorkerConfig();
      const [submissionsResult, workerTasksResult, workerHeartbeatsResult] = await Promise.all([
        supabase
          .from("application_submissions")
          .select("id, application_id, status, error_code, provider_name, provider_submission_id, receipt, updated_at")
          .order("updated_at", { ascending: false })
          .limit(30),
        supabase
          .from("application_worker_tasks")
          .select("status, created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("application_worker_heartbeats")
          .select("worker_id, last_seen_at")
          .order("last_seen_at", { ascending: false })
          .limit(20),
      ]);
      if (submissionsResult.error) throw submissionsResult.error;
      const applicationIds = (submissionsResult.data ?? []).map((row) => row.application_id);
      const packetsResult = applicationIds.length
        ? await supabase
            .from("application_packets")
            .select("id, job_snapshot")
            .in("id", applicationIds)
        : { data: [], error: null };
      if (packetsResult.error) throw packetsResult.error;
      const packetMap = new Map(
        (packetsResult.data ?? []).map((row) => [String(row.id), row.job_snapshot as Record<string, unknown>]),
      );
      const applicationRuns = (submissionsResult.data ?? []).map((row) => {
        const job = packetMap.get(String(row.application_id)) ?? {};
        const receipt = row.receipt && typeof row.receipt === "object"
          ? row.receipt as Record<string, unknown>
          : {};
        const review = receipt.review && typeof receipt.review === "object"
          ? receipt.review as Record<string, unknown>
          : {};
        const diagnostic = review.diagnostic && typeof review.diagnostic === "object"
          ? review.diagnostic as Record<string, unknown>
          : null;
        return {
          id: String(row.id),
          applicationId: String(row.application_id),
          jobTitle: String(job.title || "Application"),
          companyName: String(job.company_name || "Employer"),
          sourceHost: String(job.source_domain || ""),
          status: String(row.status || "processing"),
          errorCode: row.error_code ? String(row.error_code) : null,
          action: receipt.action ? String(receipt.action) : null,
          message: receipt.message ? String(receipt.message).slice(0, 500) : null,
          destination: receipt.destination
            ? String(receipt.destination).slice(0, 2_000)
            : null,
          diagnostic: diagnostic
            ? {
                title: String(diagnostic.title || "").slice(0, 160),
                headings: Array.isArray(diagnostic.headings)
                  ? diagnostic.headings.slice(0, 20).map((value) => String(value).slice(0, 180))
                  : [],
                actions: Array.isArray(diagnostic.actions)
                  ? diagnostic.actions.slice(0, 80)
                  : [],
                controls: Array.isArray(diagnostic.controls)
                  ? diagnostic.controls.slice(0, 80)
                  : [],
                blockedHosts: Array.isArray(diagnostic.blockedHosts)
                  ? diagnostic.blockedHosts.slice(0, 30).map((value) => String(value).slice(0, 253))
                  : [],
                networkFailures: Array.isArray(diagnostic.networkFailures)
                  ? diagnostic.networkFailures.slice(0, 30).map((value) => String(value).slice(0, 300))
                  : [],
                messages: Array.isArray(diagnostic.messages)
                  ? diagnostic.messages.slice(0, 30).map((value) => String(value).slice(0, 240))
                  : [],
              }
            : null,
          confirmationReference: row.provider_submission_id ? String(row.provider_submission_id) : null,
          updatedAt: String(row.updated_at),
        };
      });
      const workerRows = workerTasksResult.error ? [] : workerTasksResult.data ?? [];
      const heartbeatCutoff = Date.now() - 60_000;
      const onlineWorkers = workerHeartbeatsResult.error
        ? 0
        : (workerHeartbeatsResult.data ?? []).filter(
            (row) => new Date(String(row.last_seen_at)).getTime() >= heartbeatCutoff,
          ).length;
      let workerResponding = onlineWorkers > 0;
      if (workerConfig.enabled && workerConfig.url) {
        try {
          const health = await fetch(`${workerConfig.url}/health`, {
            headers: { accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(4_000),
          });
          workerResponding = workerResponding || health.ok;
        } catch {
          workerResponding = onlineWorkers > 0;
        }
      }
      const integrations = getIntegrationStatuses({ includeOperations: true }).map((item) =>
        item.id === "persistent_worker" && workerConfig.enabled && !workerResponding
          ? {
              ...item,
              state: "provider_gate" as const,
              nextStep: "The worker is configured but is not answering its health check. Restart the worker service and inspect its logs.",
            }
          : item,
      );
      const oldestQueuedAt = workerRows
        .filter((row) => row.status === "queued")
        .map((row) => String(row.created_at))
        .sort()[0] ?? null;
      return Response.json({
        integrations,
        applicationRuns,
        workerQueue: workerTasksResult.error ? undefined : {
          queued: workerRows.filter((row) => row.status === "queued").length,
          running: workerRows.filter((row) => row.status === "running").length,
          completed: workerRows.filter((row) => row.status === "completed").length,
          needsUser: workerRows.filter((row) => row.status === "needs_user").length,
          failed: workerRows.filter((row) => row.status === "failed").length,
          onlineWorkers,
          oldestQueuedAt,
        },
        systemGeneratedAt: new Date().toISOString(),
      });
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
    const body = await readJsonBody<{
      action?: string;
      jobId?: string;
      confirmation?: string;
      draft?: Partial<EmailCampaignDraft>;
      audience?: CampaignAudience;
      customEmail?: string;
      campaignId?: string;
      source?: { name?: unknown; type?: unknown; slug?: unknown };
      sourceId?: string;
      enabled?: boolean;
      recruitmentEmail?: string;
      connectionId?: string;
      feedbackId?: string;
      feedbackStatus?: FeedbackStatus;
      feedbackReply?: string;
      feedbackResolve?: boolean;
    }>(request, 2_000_000);

    if (body.action === "update_feedback_status") {
      const feedbackId = body.feedbackId?.trim() ?? "";
      const allowedStatuses: FeedbackStatus[] = ["new", "in_progress", "resolved", "spam"];
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(feedbackId)) {
        return Response.json({ error: "A valid feedback record is required." }, { status: 400 });
      }
      if (!body.feedbackStatus || !allowedStatuses.includes(body.feedbackStatus)) {
        return Response.json({ error: "Choose a valid feedback status." }, { status: 400 });
      }
      const current = await supabase.from("contact_requests").select("id, name, email, subject, message, status").eq("id", feedbackId).maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) return Response.json({ error: "Feedback was not found." }, { status: 404 });
      const statusUpdatedAt = new Date().toISOString();
      const update = await supabase
        .from("contact_requests")
        .update({ status: body.feedbackStatus, updated_at: statusUpdatedAt, resolved_at: body.feedbackStatus === "resolved" ? statusUpdatedAt : null })
        .eq("id", feedbackId)
        .select("id, user_id, name, email, company, subject, message, status, category, page_url, browser_context, attachment_path, resolution_summary, acknowledged_at, resolved_at, created_at, updated_at, messages:feedback_messages(id, feedback_id, author_type, author_user_id, author_email, message, attachment_path, created_at, read_by_user_at)")
        .maybeSingle();
      if (update.error) throw update.error;
      if (!update.data) return Response.json({ error: "Feedback was not found." }, { status: 404 });
      const audit = await supabase.from("moderation_logs").insert({
        run_type: "feedback_review",
        summary: {
          action: "status_changed",
          feedback_id: feedbackId,
          status: body.feedbackStatus,
          reviewed_by: admin.email,
        },
      });
      if (audit.error) throw audit.error;
      if (body.feedbackStatus === "resolved") {
        const systemMessage = "IR35Careers support marked this issue as resolved. Reply to the ticket if you still need help.";
        await supabase.from("feedback_messages").insert({ feedback_id: feedbackId, author_type: "system", author_email: admin.email, message: systemMessage });
        await sendFeedbackEmail({ kind: "resolved", ticketId: feedbackId, recipient: current.data.email, customerName: current.data.name, subject: current.data.subject || "Your IR35Careers feedback", message: systemMessage }).catch(() => null);
      }
      const refreshed = await supabase.from("contact_requests").select("id, user_id, name, email, company, subject, message, status, category, page_url, browser_context, attachment_path, resolution_summary, acknowledged_at, resolved_at, created_at, updated_at, messages:feedback_messages(id, feedback_id, author_type, author_user_id, author_email, message, attachment_path, created_at, read_by_user_at)").eq("id", feedbackId).single();
      if (refreshed.error) throw refreshed.error;
      const feedback = await presentAdminFeedback(enrichFeedback({ ...refreshed.data as unknown as FeedbackRecord, status: refreshed.data.status as FeedbackStatus }));
      return Response.json({ ok: true, feedback });
    }

    if (body.action === "reply_feedback") {
      const feedbackId = body.feedbackId?.trim() ?? "";
      const reply = String(body.feedbackReply ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 5_000);
      if (!/^[0-9a-f-]{36}$/i.test(feedbackId)) return Response.json({ error: "A valid feedback record is required." }, { status: 400 });
      if (reply.length < 2) return Response.json({ error: "Write a reply before sending." }, { status: 400 });
      const current = await supabase.from("contact_requests").select("id, name, email, subject, message, status").eq("id", feedbackId).maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) return Response.json({ error: "Feedback was not found." }, { status: 404 });
      const nextStatus: FeedbackStatus = body.feedbackResolve ? "resolved" : "in_progress";
      const now = new Date().toISOString();
      const inserted = await supabase.from("feedback_messages").insert({
        feedback_id: feedbackId,
        author_type: "admin",
        author_email: admin.email,
        message: reply,
      });
      if (inserted.error) throw inserted.error;
      const updated = await supabase.from("contact_requests").update({
        status: nextStatus,
        updated_at: now,
        resolved_at: body.feedbackResolve ? now : null,
        resolution_summary: body.feedbackResolve ? reply : "",
      }).eq("id", feedbackId);
      if (updated.error) throw updated.error;
      await supabase.from("moderation_logs").insert({ run_type: "feedback_reply", summary: { feedback_id: feedbackId, status: nextStatus, replied_by: admin.email } });
      await sendFeedbackEmail({
        kind: body.feedbackResolve ? "resolved" : "admin_reply",
        ticketId: feedbackId,
        recipient: current.data.email,
        customerName: current.data.name,
        subject: current.data.subject || "Your IR35Careers feedback",
        message: reply,
      }).catch(() => null);
      const refreshed = await supabase.from("contact_requests").select("id, user_id, name, email, company, subject, message, status, category, page_url, browser_context, attachment_path, resolution_summary, acknowledged_at, resolved_at, created_at, updated_at, messages:feedback_messages(id, feedback_id, author_type, author_user_id, author_email, message, attachment_path, created_at, read_by_user_at)").eq("id", feedbackId).single();
      if (refreshed.error) throw refreshed.error;
      const feedback = await presentAdminFeedback(enrichFeedback({ ...refreshed.data as unknown as FeedbackRecord, status: refreshed.data.status as FeedbackStatus }));
      return Response.json({ ok: true, feedback });
    }

    if (body.action === "test_application_runner") {
      const testedAt = new Date().toISOString();
      const token = createApplicationRunnerTestToken();
      const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://www.ir35careers.com");
      if (siteUrl.hostname === "admin.ir35careers.com") siteUrl.hostname = "www.ir35careers.com";
      siteUrl.pathname = "/";
      siteUrl.search = "";
      siteUrl.hash = "";
      const destination = new URL(`/testing/application-form?token=${encodeURIComponent(token)}`, siteUrl);
      const resumeUrl = new URL(`/api/testing/application-runner-resume?token=${encodeURIComponent(token)}`, siteUrl);
      const controlledApplicationId = "00000000-0000-4000-8000-000000000001";
      try {
        const { runNativeApplication } = await import("@/lib/application-runner/run");
        const {
          clearPortalSession,
          loadPortalSession,
          savePortalSession,
        } = await import("@/lib/application-portal-session");
        await savePortalSession({
          admin: supabase,
          userId: admin.id,
          applicationId: controlledApplicationId,
          destinationHost: siteUrl.hostname,
          session: {
            currentUrl: destination.toString(),
            storageState: { cookies: [], origins: [] },
          },
        });
        const recoveredSession = await loadPortalSession({
          admin: supabase,
          userId: admin.id,
          applicationId: controlledApplicationId,
        });
        await clearPortalSession({
          admin: supabase,
          userId: admin.id,
          applicationId: controlledApplicationId,
        });
        if (recoveredSession?.currentUrl !== destination.toString())
          throw new Error("The encrypted employer session could not be recovered.");
        const receipt = await runNativeApplication({
          applicationId: controlledApplicationId,
          destination: destination.toString(),
          job: {
            ...DEMO_JOBS[0],
            title: "Platform Engineer controlled runner test",
            company_name: "IR35Careers Test Portal",
            apply_url: destination.toString(),
            source_domain: siteUrl.hostname,
          },
          candidate: {
            ...SAMPLE_CONTRACTOR_PROFILE,
            fullName: "Alex Morgan",
            email: "runner-test@mail.ir35careers.com",
            phone: "+44 7700 900000",
            forwardingEmail: "runner-test@ir35careers.com",
            portalAccountConsent: true,
            automaticEmailVerification: true,
          },
          resume: {
            label: "Alex Morgan CV",
            text: "Alex Morgan, Platform Engineer. AWS, Terraform, Kubernetes and CI/CD delivery experience.",
            url: resumeUrl.toString(),
          },
          coverLetter: "I am applying for this controlled Platform Engineer test. My approved evidence covers AWS, Terraform, Kubernetes and CI/CD delivery. Kind regards, Alex Morgan",
          screeningAnswers: [
            { label: "Are you authorised to work in the UK?", answer: "Yes", source: "user" },
            { label: "Do you need visa sponsorship?", answer: "No", source: "user" },
            { label: "I agree to the privacy notice", answer: "Yes", source: "user" },
          ],
        }, {
          portalPassword: "Ir35!ControlledRunner7",
          resolvePortalPassword: async () => "Ir35!ControlledRunner7",
          resolveEmailVerificationCode: async () => "482731",
        });
        const unresolved = providerReviewQuestions(receipt.review).map(
          (question) => question.label,
        );
        const unresolvedDetail = unresolved.length
          ? `Still required: ${unresolved.join(", ")}.`
          : receipt.message;
        const checks = [
          { label: "Portal reached", passed: true, detail: "The protected production form was opened." },
          { label: "Session recovery", passed: true, detail: "Encrypted employer progress was stored, recovered and removed successfully." },
          { label: "CV uploaded", passed: !unresolved.some((label) => /resume|cv|curriculum/i.test(label)), detail: unresolved.some((label) => /resume|cv|curriculum/i.test(label)) ? unresolvedDetail : "The approved PDF reached the application form." },
          { label: "Fields completed", passed: receipt.state !== "needs_user", detail: receipt.state !== "needs_user" ? "Employer account, email verification, profile and screening answers completed successfully." : unresolvedDetail },
          { label: "Confirmation captured", passed: receipt.state === "submitted", detail: receipt.state === "submitted" ? "The portal returned a positive application receipt." : unresolvedDetail },
        ];
        await supabase.from("moderation_logs").insert({
          run_type: "application_runner_test",
          summary: {
            action: "controlled_production_test",
            by: admin.email,
            state: receipt.state,
            receipt_id: receipt.providerSubmissionId || null,
            tested_at: testedAt,
            checks,
          },
        });
        return Response.json({
          ok: receipt.state === "submitted",
          state: receipt.state,
          message: receipt.message,
          receiptId: receipt.providerSubmissionId || undefined,
          testedAt,
          checks,
        }, { status: receipt.state === "submitted" ? 201 : 200 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The controlled application test failed.";
        const checks = [
          { label: "Portal reached", passed: false, detail: "The runner stopped before a confirmed submission." },
          { label: "CV uploaded", passed: false, detail: "No successful upload receipt was captured." },
          { label: "Fields completed", passed: false, detail: "The full form workflow did not complete." },
          { label: "Confirmation captured", passed: false, detail: message },
        ];
        await supabase.from("moderation_logs").insert({
          run_type: "application_runner_test",
          summary: { action: "controlled_production_test", by: admin.email, state: "failed", tested_at: testedAt, message: message.slice(0, 500), checks },
        });
        return Response.json({ ok: false, state: "failed", message, testedAt, checks });
      }
    }

    if (body.action === "test_inbound_email_loop") {
      const result = await runInboundEmailLoopAudit({
        client: supabase,
        userId: admin.id,
        email: admin.email,
      });
      return Response.json(result, { status: result.ok ? 201 : 200 });
    }

    if (body.action === "recover_stale_submissions") {
      const staleBefore = new Date(
        Date.now() - SUBMISSION_LOCK_MAX_AGE_MS,
      ).toISOString();
      const [staleResult, legacyFailureResult, recoverableNeedsUserResult] = await Promise.all([
        supabase
          .from("application_submissions")
          .select("id, user_id, application_id, idempotency_key, receipt, updated_at")
          .eq("status", "processing")
          .or("error_code.is.null,error_code.neq.needs_user")
          .lt("updated_at", staleBefore)
          .limit(500),
        supabase
          .from("application_submissions")
          .select("id, user_id, application_id, idempotency_key, receipt, updated_at")
          .eq("status", "failed")
          .eq("provider_name", "IR35Careers application runner")
          .in("error_code", [
            "provider_error",
            "temporary_runner_error",
            "stale_processing",
          ])
          .limit(500),
        supabase
          .from("application_submissions")
          .select("id, user_id, application_id, idempotency_key, receipt, updated_at")
          .eq("status", "processing")
          .eq("error_code", "needs_user")
          .limit(500),
      ]);
      if (
        staleResult.error ||
        legacyFailureResult.error ||
        recoverableNeedsUserResult.error
      )
        throw (
          staleResult.error ||
          legacyFailureResult.error ||
          recoverableNeedsUserResult.error
        );
      const recoverableNeedsUserActions = new Set([
        "browser_continue",
        "employer_login",
        "account_recovery_email",
        "verification_link",
        // An administrator uses this recovery action after deploying support
        // for a changed employer form. The original approved task and exact
        // destination are reused, so no new application is created.
        "unsupported_form",
        // A worker interruption or bounded portal timeout is safe to retry
        // from the existing approved, idempotent task after the runner has
        // been repaired. Without this entry the admin recovery control reports
        // success but leaves the application permanently in Needs action.
        "runner_timeout",
      ]);
      const recoverableNeedsUser = (recoverableNeedsUserResult.data ?? []).filter(
        (submission) => {
          const receipt = submission.receipt as Record<string, unknown> | null;
          return recoverableNeedsUserActions.has(String(receipt?.action ?? ""));
        },
      );
      const stale = Array.from(
        new Map(
          [
            ...(staleResult.data ?? []),
            ...(legacyFailureResult.data ?? []),
            ...recoverableNeedsUser,
          ].map((submission) => [submission.id, submission]),
        ).values(),
      );
      const workerConfig = applicationWorkerConfig();
      const callbackUrl = new URL(
        "/api/applications/worker/callback",
        "https://www.ir35careers.com",
      );
      let requeued = 0;
      for (const submission of stale) {
        const now = new Date().toISOString();
        const [packetResult, existingTaskResult] = await Promise.all([
          supabase
            .from("application_packets")
            .select("job_snapshot, screening_answers, truth_approved, materials_approved, submission_approved")
            .eq("id", submission.application_id)
            .eq("user_id", submission.user_id)
            .maybeSingle(),
          supabase
            .from("application_worker_tasks")
            .select("destination")
            .eq("user_id", submission.user_id)
            .eq("application_id", submission.application_id)
            .eq("idempotency_key", submission.idempotency_key)
            .maybeSingle(),
        ]);
        if (packetResult.error || existingTaskResult.error)
          throw packetResult.error || existingTaskResult.error;
        const packet = packetResult.data as
          | {
              job_snapshot?: Record<string, unknown>;
              screening_answers?: Array<Record<string, unknown>>;
              truth_approved?: boolean;
              materials_approved?: boolean;
              submission_approved?: boolean;
            }
          | null;
        const destination = String(
          existingTaskResult.data?.destination ||
            packet?.job_snapshot?.apply_url ||
            "",
        ).trim();
        const idempotencyKey = String(
          submission.idempotency_key || `application:${submission.application_id}`,
        ).trim();
        let secureDestination = false;
        try {
          secureDestination = new URL(destination).protocol === "https:";
        } catch {
          secureDestination = false;
        }
        const questionsReady = (packet?.screening_answers ?? []).every(
          (question) =>
            !question.required ||
            (question.reviewed === true && String(question.answer ?? "").trim()),
        );
        const hasPriorApprovedWorkerTask = Boolean(existingTaskResult.data);
        const canRequeue = Boolean(
          workerConfig.enabled &&
            callbackUrl.protocol === "https:" &&
            secureDestination &&
            idempotencyKey &&
            packet?.truth_approved &&
            packet?.materials_approved &&
            questionsReady &&
            (packet?.submission_approved || hasPriorApprovedWorkerTask),
        );
        if (canRequeue) {
          const { error: workerQueueError } = await supabase
            .from("application_worker_tasks")
            .upsert(
              {
                user_id: submission.user_id,
                application_id: submission.application_id,
                idempotency_key: idempotencyKey,
                destination,
                callback_url: callbackUrl.toString(),
                status: "queued",
                attempts: 0,
                available_at: now,
                lease_owner: null,
                lease_expires_at: null,
                last_error: null,
                completed_at: null,
              },
              { onConflict: "user_id,idempotency_key" },
            );
          if (workerQueueError) throw workerQueueError;
          const [submissionUpdate, packetUpdate, eventUpdate] = await Promise.all([
            supabase
              .from("application_submissions")
              .update({
                status: "processing",
                error_code: null,
                receipt: {
                  state: "processing",
                  message:
                    "The approved application is queued for the employer portal.",
                },
                updated_at: now,
              })
              .eq("id", submission.id),
            supabase
              .from("application_packets")
              .update({
                status: "ready",
                submission_approved: true,
                updated_at: now,
              })
              .eq("id", submission.application_id)
              .eq("user_id", submission.user_id),
            supabase.from("application_events").upsert(
              {
                user_id: submission.user_id,
                application_id: submission.application_id,
                event_type: "status_changed",
                label: "Application requeued for background submission",
                idempotency_key: `submit:${submission.application_id}:requeued:${String(submission.updated_at)}`,
                metadata: {
                  recoveredBy: admin.email,
                  reason: "persistent_worker_available",
                },
              },
              {
                onConflict: "user_id,idempotency_key",
                ignoreDuplicates: true,
              },
            ),
          ]);
          if (
            submissionUpdate.error ||
            packetUpdate.error ||
            eventUpdate.error
          )
            throw (
              submissionUpdate.error ||
              packetUpdate.error ||
              eventUpdate.error
            );
          requeued += 1;
          continue;
        }
        const message =
          "The employer portal did not finish in the background. Continue the same approved application on the employer page.";
        const attention = buildApplicationAttention({
          action: "browser_continue",
          message,
        });
        const [
          { error: updateError },
          { error: packetError },
          { error: eventError },
        ] = await Promise.all([
          supabase
            .from("application_submissions")
            .update({
              status: "processing",
              error_code: "needs_user",
              receipt: {
                state: "needs_user",
                message,
                action: "browser_continue",
                attention,
              },
              updated_at: now,
            })
            .eq("id", submission.id),
          supabase
            .from("application_packets")
            .update({ status: "needs_review", updated_at: now })
            .eq("id", submission.application_id)
            .eq("user_id", submission.user_id),
          supabase.from("application_events").upsert(
            {
              user_id: submission.user_id,
              application_id: submission.application_id,
              event_type: "status_changed",
              label: "Application needs secure browser continuation",
              idempotency_key: `submit:${submission.application_id}:stale:${String(submission.updated_at)}`,
              metadata: {
                recoveredBy: admin.email,
                reason: "browser_continue",
                attention,
              },
            },
            {
              onConflict: "user_id,idempotency_key",
              ignoreDuplicates: true,
            },
          ),
        ]);
        if (updateError || packetError || eventError)
          throw updateError || packetError || eventError;
      }
      const audit = await supabase.from("moderation_logs").insert({
        run_type: "application_recovery",
        summary: {
          action: "recover_stale_submissions",
          recovered: stale.length,
          requeued,
          by: admin.email,
        },
      });
      if (audit.error) throw audit.error;
      return Response.json({ recovered: stale.length, requeued });
    }

    if ((body.action === "approve_employer_connection" || body.action === "reject_employer_connection") && body.connectionId) {
      const pendingResult = await supabase
        .from("moderation_logs")
        .select("id, summary, created_at")
        .eq("id", body.connectionId)
        .eq("run_type", "employer_destination_verification")
        .maybeSingle();
      if (pendingResult.error) throw pendingResult.error;
      const pendingSummary = pendingResult.data?.summary as Record<string, unknown> | undefined;
      const requestLogId = String(pendingSummary?.request_log_id ?? "").trim();
      const sourceId = String(pendingSummary?.source_id ?? "").trim();
      const sourceName = String(pendingSummary?.source_name ?? "Employer").trim().slice(0, 100);
      const email = String(pendingSummary?.email ?? "").trim().toLowerCase();
      if (pendingSummary?.action !== "employer_confirmed" || !requestLogId || !sourceId || !validRecruitmentEmail(email)) {
        return Response.json({ error: "The employer connection request is unavailable." }, { status: 404 });
      }
      const resolvedResult = await supabase
        .from("moderation_logs")
        .select("id, summary")
        .eq("run_type", "employer_destination_verification")
        .contains("summary", { request_log_id: requestLogId })
        .limit(20);
      if (resolvedResult.error) throw resolvedResult.error;
      const alreadyResolved = (resolvedResult.data ?? []).some((row) => {
        const action = String((row.summary as Record<string, unknown> | null)?.action ?? "");
        return action === "verified" || action === "rejected";
      });
      if (alreadyResolved) return Response.json({ error: "This employer connection has already been reviewed." }, { status: 409 });
      const sources = await loadManagedJobSources(supabase);
      if (!sources.some((source) => source.id === sourceId)) {
        return Response.json({ error: "The associated public job source is unavailable." }, { status: 409 });
      }
      const now = new Date().toISOString();
      const approved = body.action === "approve_employer_connection";
      if (approved) {
        await saveEmployerDestination({
          sourceId,
          email,
          enabled: true,
          verifiedAt: now,
          updatedAt: now,
        }, admin.email, supabase);
      }
      const reviewAudit = await supabase.from("moderation_logs").insert({
        run_type: "employer_destination_verification",
        summary: {
          action: approved ? "verified" : "rejected",
          source_id: sourceId,
          source_name: sourceName,
          email,
          request_log_id: requestLogId,
          confirmation_log_id: pendingResult.data?.id,
          reviewed_at: now,
          reviewed_by: admin.email,
          request_kind: "employer_self_service",
        },
      });
      if (reviewAudit.error) {
        if (approved) {
          await saveEmployerDestination({
            sourceId,
            email,
            enabled: false,
            verifiedAt: now,
            updatedAt: new Date().toISOString(),
          }, admin.email, supabase);
        }
        throw reviewAudit.error;
      }
      const emailConfig = transactionalEmailConfig();
      if (emailConfig) {
        const safeSource = sourceName.replace(/[&<>"']/g, "");
        await getTransactionalResend(emailConfig).emails.send({
          from: emailConfig.from,
          to: [email],
          subject: approved ? `${sourceName} is connected to IR35Careers` : `${sourceName} connection update`,
          html: `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:620px;background:#fff;border:1px solid #dbe4ec;border-radius:18px;overflow:hidden"><tr><td style="background:#052e2b;padding:24px 28px;color:#fff;font-size:18px;font-weight:700">IR35Careers</td></tr><tr><td style="padding:30px 28px"><h1 style="margin:0;font-size:24px">${approved ? "Connection approved" : "Connection not approved"}</h1><p style="margin:16px 0;color:#475569;font-size:14px;line-height:22px">${approved ? `${safeSource} can now receive candidate-approved applications through the verified recruitment address.` : `We could not approve direct application delivery for ${safeSource}. Its public job board may still be reviewed for listing coverage. Contact IR35Careers if the organisation or recruitment address needs correction.`}</p></td></tr></table></td></tr></table></body></html>`,
          text: approved
            ? `${sourceName} can now receive candidate-approved applications through the verified recruitment address on IR35Careers.`
            : `We could not approve direct application delivery for ${sourceName}. Contact IR35Careers if the organisation or recruitment address needs correction.`,
          ...(emailConfig.replyTo ? { replyTo: emailConfig.replyTo } : {}),
          tags: [{ name: "email_type", value: "employer_connection_review" }],
        });
      }
      return Response.json({ ok: true, approved, sourceName, email });
    }

    if (body.action === "request_employer_destination_verification" && body.sourceId) {
      if (!validRecruitmentEmail(body.recruitmentEmail)) {
        return Response.json({ error: "Enter a valid employer recruitment email address." }, { status: 400 });
      }
      const sources = await loadManagedJobSources(supabase);
      const source = sources.find((item) => item.id === body.sourceId);
      if (!source) return Response.json({ error: "Job source was not found." }, { status: 404 });
      const verification = await requestEmployerDestinationVerification({
        source,
        recruitmentEmail: body.recruitmentEmail,
        requestedBy: admin.email,
        requestKind: "admin",
        client: supabase,
      });
      return Response.json({ ok: true, email: verification.email, expiresAt: verification.expiresAt }, { status: 201 });
    }

    if (body.action === "upsert_job_source") {
      const source = validateManagedJobSource(body.source ?? {});
      const verification = await fetchCompany(new HttpClient({
        minDelayMs: 0,
        timeoutMs: 10_000,
        maxRetries: 1,
        baseBackoffMs: 300,
      }), source);
      if (verification.error) {
        return Response.json({ error: `The public ${source.type} board could not be verified: ${verification.error}` }, { status: 400 });
      }
      const current = await loadManagedJobSources(supabase);
      const saved = await saveManagedJobSources(upsertManagedSource(current, source), admin.email, supabase);
      return Response.json({
        ok: true,
        source: saved.find((item) => item.type === source.type && item.slug === source.slug),
        publishedJobsFound: verification.jobs.length,
      }, { status: 201 });
    }

    if (body.action === "toggle_job_source" && body.sourceId) {
      const current = await loadManagedJobSources(supabase);
      const saved = await saveManagedJobSources(
        setManagedSourceEnabled(current, body.sourceId, body.enabled === true),
        admin.email,
        supabase
      );
      return Response.json({ ok: true, source: saved.find((item) => item.id === body.sourceId) });
    }

    if (body.action === "remove_job_source" && body.sourceId) {
      const current = await loadManagedJobSources(supabase);
      const saved = await saveManagedJobSources(removeManagedSource(current, body.sourceId), admin.email, supabase);
      return Response.json({ ok: true, total: saved.length });
    }

    if (body.action === "run_job_pipeline") {
      const summary = await runFetchPipeline();
      return Response.json({ ok: true, summary });
    }

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
      { status: err instanceof RequestBodyError ? err.status : 500 }
    );
  }
}
