import { buildLocalTailoringResult } from "@/lib/ai/local-tailoring";
import { openRouterTailoringConfig, tailorResumeWithOpenRouter } from "@/lib/ai/openrouter-tailoring";
import {
  applyTailoringResult,
  autoApplyNeedsReview,
  autoApplyReviewReason,
  hasCurrentAutoApplyConsent,
  laneMatchesJob,
  unresolvedRequiredQuestions,
} from "@/lib/automation/auto-apply";
import { FREE_DAILY_APPLICATION_LIMIT, maximumDailyApplicationLimit } from "@/lib/automation/daily-limit";
import { DAILY_LIMIT_COUNTED_SUBMISSION_STATUSES } from "@/lib/automation/daily-usage";
import { verifyScheduledAutoApplyAuthorization } from "@/lib/automation/internal-auth";
import { sendApplicationNotification } from "@/lib/email/application-notifications";
import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { evaluateAutomationJob, prepareApplication } from "@/lib/workspace/engine";
import type { ApplicationPreferences, ApplicationRecord, AutomationRules, ContractorProfile, ResumeProfile } from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { createApplicationResumeAuthorization } from "@/lib/application-internal-resume";
import { automaticSubmissionPriority } from "@/lib/application-runner/source-resolution";

export const runtime = "nodejs";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

type DbRow = Record<string, unknown>;

function resumeForProfile(profile: ContractorProfile): ResumeProfile | null {
  const profiles = profile.resumeProfiles ?? [];
  return profiles.find((item) => item.id === profile.activeResumeProfileId)
    ?? profiles.find((item) => item.isDefault)
    ?? profiles[0]
    ?? null;
}

function rulesFromRow(row: DbRow, maximumDailyLimit: number): AutomationRules {
  return {
    enabled: Boolean(row.enabled),
    dryRunOnly: true,
    minimumMatch: Number(row.minimum_match ?? 70),
    minimumDayRate: Number(row.minimum_day_rate ?? 0),
    ir35: (row.ir35_statuses as AutomationRules["ir35"]) ?? ["outside"],
    workplaces: (row.workplaces as AutomationRules["workplaces"]) ?? ["remote", "hybrid"],
    dailyLimit: Math.max(1, Math.min(Number(row.daily_limit ?? FREE_DAILY_APPLICATION_LIMIT), maximumDailyLimit)),
    prepareCoverLetter: Boolean(row.prepare_cover_letter ?? true),
    requireHumanApproval: true,
    excludedCompanies: (row.excluded_companies as string[]) ?? [],
  };
}

function packetRow(application: ApplicationRecord, userId: string): Record<string, unknown> {
  return {
    id: application.id,
    user_id: userId,
    job_id: application.job.id,
    job_snapshot: application.job,
    status: application.status,
    mode: application.mode,
    match_score: application.matchScore,
    resume_version_label: application.resumeVersionLabel,
    source_cv_text: application.sourceCvText,
    tailored_cv_text: application.tailoredCvText,
    cover_letter: application.coverLetter,
    screening_answers: application.questions,
    matched_keywords: application.matchedKeywords,
    missing_keywords: application.missingKeywords,
    truth_approved: application.truthApproved,
    materials_approved: application.materialsApproved,
    submission_approved: application.submissionApproved,
    receipt: application.receipt,
    idempotency_key: `auto:${application.job.id}`,
    created_at: application.createdAt,
    updated_at: application.updatedAt,
  };
}

async function saveNeedsUser(application: ApplicationRecord, userId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error: packetError } = await admin.from("application_packets").upsert(packetRow(application, userId), { onConflict: "user_id,idempotency_key" });
  if (packetError) throw new Error(packetError.message);
  const { error: eventError } = await admin.from("application_events").upsert({
    id: application.events[0]?.id,
    user_id: userId,
    application_id: application.id,
    event_type: "status_changed",
    label: "Auto Apply needs your answers",
    metadata: { missingQuestionCount: unresolvedRequiredQuestions(application.questions).length },
    idempotency_key: `auto:${application.job.id}:needs-user`,
    created_at: application.updatedAt,
  }, { onConflict: "user_id,idempotency_key" });
  if (eventError) throw new Error(eventError.message);
}

async function saveForReview(
  application: ApplicationRecord,
  userId: string,
  label: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error: packetError } = await admin
    .from("application_packets")
    .upsert(packetRow(application, userId), {
      onConflict: "user_id,idempotency_key",
    });
  if (packetError) throw new Error(packetError.message);
  const { error: eventError } = await admin.from("application_events").upsert(
    {
      id: crypto.randomUUID(),
      user_id: userId,
      application_id: application.id,
      event_type: "prepared",
      label,
      metadata: { source: "auto_apply", reviewRequired: true },
      idempotency_key: `auto:${application.job.id}:review-ready`,
      created_at: application.updatedAt,
    },
    { onConflict: "user_id,idempotency_key" },
  );
  if (eventError) throw new Error(eventError.message);
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  try {
    const body = await readJsonBody<{
      rules?: Partial<AutomationRules>;
      preferences?: Partial<ApplicationPreferences>;
      internalUserId?: string;
    }>(request, 150_000);
    const admin = getSupabaseAdmin();
    const internalUserId = /^[0-9a-f-]{36}$/i.test(body.internalUserId ?? "")
      ? String(body.internalUserId)
      : "";
    const internalAuthorized = Boolean(
      internalUserId &&
      verifyScheduledAutoApplyAuthorization({
        userId: internalUserId,
        timestamp: request.headers.get("x-ir35-auto-apply-timestamp")?.trim() ?? "",
        suppliedSignature: request.headers.get("x-ir35-auto-apply-signature")?.trim() ?? "",
      }),
    );
    if (!token && !internalAuthorized)
      return Response.json(
        { error: "Sign in again before running Auto Apply." },
        { status: 401, headers: NO_STORE },
      );
    const { data: authData, error: authError } = internalAuthorized
      ? await admin.auth.admin.getUserById(internalUserId)
      : await admin.auth.getUser(token);
    if (authError || !authData.user) return Response.json({ error: "Your session has expired. Sign in again." }, { status: 401, headers: NO_STORE });
    const userId = authData.user.id;

    const [
      { data: profileRow, error: profileError },
      { data: ruleRow, error: ruleError },
      { data: entitlementRow, error: entitlementError },
    ] = await Promise.all([
      admin.from("profiles").select("application_profile").eq("id", userId).maybeSingle(),
      admin.from("automation_rules").select("*").eq("user_id", userId).maybeSingle(),
      admin.from("user_entitlements").select("plan, billing_state").eq("user_id", userId).maybeSingle(),
    ]);
    if (profileError || ruleError || entitlementError) throw new Error(profileError?.message || ruleError?.message || entitlementError?.message);
    const profile = ((profileRow?.application_profile ?? {}) as ContractorProfile);
    const entitlement = {
      plan: entitlementRow?.plan === "pro" ? "pro" as const : "free" as const,
      billingState: entitlementRow?.billing_state === "active" ? "active" as const : "not_connected" as const,
    };
    const maximumDailyLimit = maximumDailyApplicationLimit(entitlement);
    const storedPreferences = (profile.applicationPreferences ?? {}) as ApplicationPreferences;
    const requestedLanes = Array.isArray(body.preferences?.autoApplyLanes)
      ? body.preferences.autoApplyLanes.slice(0, 3).map((lane, index) => ({
          id: String(lane.id || `lane-${index + 1}`).slice(0, 80),
          role: String(lane.role || "").trim().slice(0, 120),
          keywords: Array.isArray(lane.keywords) ? lane.keywords.map((item) => String(item).trim().slice(0, 80)).filter(Boolean).slice(0, 12) : [],
          location: String(lane.location || "United Kingdom").trim().slice(0, 120),
          enabled: lane.enabled !== false,
        }))
      : storedPreferences.autoApplyLanes;
    const preferences: ApplicationPreferences = {
      applicationMode:
        body.preferences?.applicationMode ??
        storedPreferences.applicationMode ??
        "automatic",
      guidedReviewThreshold:
        body.preferences?.guidedReviewThreshold ??
        storedPreferences.guidedReviewThreshold ??
        80,
      resumeOptimisation:
        body.preferences?.resumeOptimisation ??
        storedPreferences.resumeOptimisation ??
        "honest",
      autoApproveSafeEdits:
        body.preferences?.autoApproveSafeEdits ??
        storedPreferences.autoApproveSafeEdits ??
        true,
      reviewBeforeSubmit:
        (body.preferences?.applicationMode ??
          storedPreferences.applicationMode ??
          "automatic") === "review",
      generateCoverLetter:
        body.preferences?.generateCoverLetter ??
        storedPreferences.generateCoverLetter ??
        true,
      usePrivateApplicationEmail:
        body.preferences?.usePrivateApplicationEmail ??
        storedPreferences.usePrivateApplicationEmail ??
        true,
      autoApplyEnabled:
        body.preferences?.autoApplyEnabled ?? storedPreferences.autoApplyEnabled,
      autoApplyConsentAt:
        body.preferences?.autoApplyConsentAt ??
        storedPreferences.autoApplyConsentAt,
      autoApplyConsentVersion:
        body.preferences?.autoApplyConsentVersion ??
        storedPreferences.autoApplyConsentVersion,
      autoApplyLanes: requestedLanes,
    };
    if (!hasCurrentAutoApplyConsent({ enabled: preferences.autoApplyEnabled, consentAt: preferences.autoApplyConsentAt, consentVersion: preferences.autoApplyConsentVersion })) {
      return Response.json({ error: "Review and accept the current Auto Apply consent before starting.", action: "/automation" }, { status: 409, headers: NO_STORE });
    }
    const requestedRules = body.rules;
    const requestedDailyLimit = Number(requestedRules?.dailyLimit ?? FREE_DAILY_APPLICATION_LIMIT);
    if (requestedRules && requestedDailyLimit > maximumDailyLimit) {
      return Response.json({
        state: "premium_required",
        error: `Free accounts can run up to ${FREE_DAILY_APPLICATION_LIMIT} applications per day. Premium plans with higher limits are coming soon.`,
        action: "/automation",
      }, { status: 403, headers: NO_STORE });
    }
    const effectiveRuleRow: DbRow = requestedRules ? {
      ...(ruleRow as DbRow | null),
      enabled: requestedRules.enabled === true,
      minimum_match: Math.max(40, Math.min(Number(requestedRules.minimumMatch ?? 70), 95)),
      minimum_day_rate: Math.max(0, Math.min(Number(requestedRules.minimumDayRate ?? 0), 3_000)),
      ir35_statuses: requestedRules.ir35 ?? ["outside"],
      workplaces: requestedRules.workplaces ?? ["remote", "hybrid"],
      daily_limit: Math.max(1, Math.min(requestedDailyLimit, maximumDailyLimit)),
      prepare_cover_letter: requestedRules.prepareCoverLetter !== false,
      excluded_companies: requestedRules.excludedCompanies ?? [],
    } : (ruleRow as DbRow | null) ?? {};
    if (!effectiveRuleRow.enabled) return Response.json({ error: "Turn on Auto Apply and save your matching rules first.", action: "/automation" }, { status: 409, headers: NO_STORE });

    if (body.preferences || requestedRules) {
      const now = new Date().toISOString();
      const [{ error: saveProfileError }, { error: saveRulesError }] = await Promise.all([
        admin.from("profiles").upsert({ id: userId, application_profile: { ...profile, applicationPreferences: preferences }, updated_at: now }),
        admin.from("automation_rules").upsert({
          user_id: userId,
          enabled: Boolean(effectiveRuleRow.enabled),
          dry_run_only: true,
          minimum_match: effectiveRuleRow.minimum_match,
          minimum_day_rate: effectiveRuleRow.minimum_day_rate,
          ir35_statuses: effectiveRuleRow.ir35_statuses,
          workplaces: effectiveRuleRow.workplaces,
          daily_limit: effectiveRuleRow.daily_limit,
          prepare_cover_letter: effectiveRuleRow.prepare_cover_letter,
          require_human_approval: true,
          excluded_companies: effectiveRuleRow.excluded_companies,
          updated_at: now,
        }),
      ]);
      if (saveProfileError || saveRulesError) throw new Error(saveProfileError?.message || saveRulesError?.message);
      profile.applicationPreferences = preferences;
    }

    const resume = resumeForProfile(profile);
    if (!resume?.resumeText.trim()) return Response.json({ error: "Add a Resume to your Application Profile before starting Auto Apply.", action: "/profile" }, { status: 422, headers: NO_STORE });

    const rules = rulesFromRow(effectiveRuleRow, maximumDailyLimit);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const { count: attemptsToday, error: countError } = await admin.from("application_submissions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", [...DAILY_LIMIT_COUNTED_SUBMISSION_STATUSES])
      .gte("created_at", today.toISOString());
    if (countError) throw new Error(countError.message);
    if ((attemptsToday ?? 0) >= rules.dailyLimit) {
      return Response.json({ state: "limit_reached", message: `Your daily Auto Apply limit of ${rules.dailyLimit} has been reached.` }, { status: 429, headers: NO_STORE });
    }

    const [{ data: jobs, error: jobsError }, { data: existing, error: existingError }] = await Promise.all([
      admin.from("jobs").select("*").is("expired_at", null).order("posted_on", { ascending: false, nullsFirst: false }).limit(80),
      admin.from("application_packets").select("job_id").eq("user_id", userId),
    ]);
    if (jobsError || existingError) throw new Error(jobsError?.message || existingError?.message);
    const seen = new Set((existing ?? []).map((row) => String(row.job_id ?? "")));

    const orderedJobs = (jobs ?? [])
      .map((row, index) => ({
        job: row as unknown as JobDetail,
        index,
      }))
      .sort(
        (left, right) =>
          automaticSubmissionPriority(right.job) -
            automaticSubmissionPriority(left.job) ||
          left.index - right.index,
      );

    let application: ApplicationRecord | null = null;
    for (const { job } of orderedJobs) {
      if (seen.has(job.id) || !job.apply_url || !laneMatchesJob(preferences.autoApplyLanes, job)) continue;
      const candidate = prepareApplication({ job, profile, cvText: resume.resumeText, resumeVersionLabel: resume.name });
      if (evaluateAutomationJob(job, candidate.matchScore, rules)) continue;
      application = candidate;
      break;
    }
    if (!application) return Response.json({ state: "no_match", message: "No new contract currently meets your saved Auto Apply rules." }, { headers: NO_STORE });

    const prepareRoleMaterials =
      preferences.resumeOptimisation !== "off" ||
      preferences.generateCoverLetter;
    if (prepareRoleMaterials) {
      let tailoring;
      try {
        tailoring = openRouterTailoringConfig()
          ? await tailorResumeWithOpenRouter({
              cvText: application.sourceCvText,
              job: application.job,
              timeoutMs: 25_000,
            })
          : buildLocalTailoringResult(
              application.sourceCvText,
              application.job,
            );
      } catch {
        tailoring = buildLocalTailoringResult(
          application.sourceCvText,
          application.job,
        );
      }
      if (
        preferences.resumeOptimisation !== "off" &&
        preferences.autoApproveSafeEdits
      )
        application = applyTailoringResult(application, tailoring);
      else if (preferences.generateCoverLetter && tailoring.coverLetter.trim())
        application = {
          ...application,
          coverLetter: tailoring.coverLetter.trim(),
          updatedAt: new Date().toISOString(),
        };
    }
    if (!preferences.generateCoverLetter)
      application = { ...application, coverLetter: "" };
    const missing = unresolvedRequiredQuestions(application.questions);
    if (missing.length > 0) {
      application = { ...application, status: "needs_review", submissionApproved: false, updatedAt: new Date().toISOString() };
      await saveNeedsUser(application, userId);
      const inbox = await ensureInboxAlias(admin, userId, authData.user.email ?? profile.forwardingEmail ?? profile.email, true);
      await sendApplicationNotification({
        kind: "needs_attention",
        to: inbox?.forwardingEmail || authData.user.email || profile.forwardingEmail || profile.email,
        userId,
        inboxAlias: inbox?.alias,
        candidateName: profile.fullName,
        jobTitle: application.job.title,
        companyName: application.job.company_name,
        jobId: application.job.id,
        applicationId: application.id,
        questionLabels: missing.map((question) => question.label),
        idempotencyKey: `auto:${application.job.id}:needs-user`,
      }).catch(() => null);
      return Response.json({ state: "needs_user", application, questions: missing, message: `${missing.length} employer answer${missing.length === 1 ? " is" : "s are"} needed before this application can be sent.` }, { status: 202, headers: NO_STORE });
    }

    if (autoApplyNeedsReview(preferences, application.matchScore)) {
      const reviewReason = autoApplyReviewReason(preferences, application.matchScore);
      const materialsApproved = Boolean(
        preferences.autoApproveSafeEdits ||
          preferences.resumeOptimisation === "off",
      );
      application = {
        ...application,
        status: materialsApproved ? "ready" : "needs_review",
        truthApproved: materialsApproved,
        materialsApproved,
        submissionApproved: false,
        updatedAt: new Date().toISOString(),
        events: [
          ...application.events,
          {
            id: crypto.randomUUID(),
            applicationId: application.id,
            type: "prepared",
            label: reviewReason,
            createdAt: new Date().toISOString(),
          },
        ],
      };
      await saveForReview(application, userId, reviewReason);
      return Response.json(
        {
          state: "review_ready",
          application,
          message: reviewReason,
          action: `/applications/new/${application.job.id}`,
        },
        { status: 202, headers: NO_STORE },
      );
    }

    application = {
      ...application,
      status: "ready",
      mode: "external_handoff",
      truthApproved: true,
      materialsApproved: true,
      submissionApproved: true,
      updatedAt: new Date().toISOString(),
    };
    const internalSubmissionAuthorization = internalAuthorized
      ? createApplicationResumeAuthorization({
          applicationId: application.id,
          userId,
        })
      : null;
    const submitHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (internalSubmissionAuthorization) {
      submitHeaders["x-ir35-resume-timestamp"] = internalSubmissionAuthorization.timestamp;
      submitHeaders["x-ir35-resume-signature"] = internalSubmissionAuthorization.signature;
    } else if (authorization) {
      submitHeaders.authorization = authorization;
    }
    const submitResponse = await fetch(new URL("/api/applications/submit", request.url), {
      method: "POST",
      headers: submitHeaders,
      body: JSON.stringify({
        applicationId: application.id,
        approval: "SUBMIT_APPROVED_APPLICATION",
        packet: application,
        internalUserId: internalAuthorized ? userId : undefined,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(105_000),
    });
    const payload = await submitResponse.json() as { state?: string; receipt?: ApplicationRecord["receipt"]; questions?: ApplicationRecord["questions"]; message?: string; action?: string; error?: string };
    if (payload.receipt) application = { ...application, status: "applied", receipt: payload.receipt, updatedAt: new Date().toISOString() };
    else if (payload.state === "needs_user") application = { ...application, status: "needs_review", questions: payload.questions ?? application.questions, submissionApproved: false, updatedAt: new Date().toISOString() };
    else application = { ...application, events: [...application.events, { id: crypto.randomUUID(), applicationId: application.id, type: "status_changed", label: "Application submission started", createdAt: new Date().toISOString() }] };

    return Response.json({ ...payload, application }, { status: submitResponse.status, headers: NO_STORE });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    console.error("auto_apply_next_failed", {
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "Auto Apply could not complete this contract. No application was marked as submitted." }, { status: 502, headers: NO_STORE });
  }
}
