"use client";

import { getSupabase } from "@/lib/supabase";
import { createSeedWorkspaceState } from "@/lib/workspace/seed";
import type {
  ApplicationEvent,
  ApplicationRecord,
  AutomationPreview,
  AutomationRules,
  ContractorProfile,
  Entitlement,
  InboxMessage,
  InboxSettings,
  WorkspaceState,
} from "@/lib/workspace/types";
import { isUnsolicitedJobMarketingMessage } from "@/lib/workspace/mail";
import { normaliseResumeText } from "@/lib/resume/normalise-text";
import type { JobDetail } from "@/lib/job-types";
import { submissionAttentionFromRow } from "@/lib/workspace/submission-attention";
import { clampDailyApplicationLimit } from "@/lib/automation/daily-limit";
import {
  normaliseCoverLetterSignoff,
  normaliseCoverLetterTerminology,
  resolveCandidateName,
  stripCoverLetterSignoff,
} from "@/lib/candidate-name";

type DbRow = Record<string, unknown>;

const CLOUD_APPLICATION_LIMIT = 100;
const CLOUD_EVENT_LIMIT = 1_000;
const CLOUD_MESSAGE_LIMIT = 250;
const CLOUD_SUBMISSION_LIMIT = 200;

export function createBlankCloudWorkspaceState(email: string): WorkspaceState {
  const seed = createSeedWorkspaceState();
  return {
    ...seed,
    profile: {
      ...seed.profile,
      fullName: "",
      email,
      phone: "",
      location: "",
      addressLine1: "",
      city: "",
      county: "",
      postcode: "",
      country: "United Kingdom",
      isOver18: null,
      canWorkInPerson: null,
      canRelocate: null,
      canStartImmediately: null,
      hasTransportation: null,
      needsAccommodation: null,
      workedForCompanyBefore: null,
      hasGovernmentClearance: null,
      hasGovernmentTies: null,
      willingToTravel: null,
      willingToWorkShifts: null,
      willingToWorkWeekends: null,
      backgroundCheckConsent: null,
      criminalConvictionsToDeclare: null,
      targetDayRate: "",
      targetAnnualSalary: "",
      yearsOfExperience: "",
      referralSource: "",
      portalAccountConsent: false,
      employerTermsConsent: false,
      automaticEmailVerification: false,
      educationInstitution: "",
      educationQualification: "",
      linkedInUrl: "",
      portfolioUrl: "",
      rightToWork: "prefer_not_to_say",
      availability: "",
      noticePeriod: "",
      limitedCompanyName: "",
      companyNumber: "",
      vatRegistered: false,
      clearance: "",
      defaultCvLabel: "",
      professionalSummary: "",
      targetRole: "",
      githubUrl: "",
      skills: [],
      certifications: [],
      experienceText: "",
      projectsText: "",
      resumeProfiles: [],
      activeResumeProfileId: undefined,
      profileSetupCompletedAt: undefined,
      networkContacts: [],
      referralRequests: [],
      savedApplicationAnswers: [],
      experience: undefined,
      forwardingEmail: email,
    },
    applications: [],
    messages: [],
    automationRuns: [],
    inbox: {
      alias: "Not created",
      forwardingEmail: email,
      forwardingEnabled: false,
      providerState: "not_connected",
    },
    entitlement: {
      plan: "free",
      preparationCredits: 25,
      billingState: "not_connected",
    },
  };
}

function asProfile(
  value: unknown,
  fallback: ContractorProfile,
): ContractorProfile {
  if (!value || typeof value !== "object") return fallback;
  return { ...fallback, ...(value as Partial<ContractorProfile>) };
}

function profileFromRow(row: DbRow | null, fallback: ContractorProfile): ContractorProfile {
  const profile = asProfile(row?.application_profile, fallback);
  if (!row) return profile;
  const legacySkills = Array.isArray(row.skills)
    ? row.skills.filter((item): item is string => typeof item === "string")
    : [];
  const legacyYears = Number(row.years_experience);
  const merged: ContractorProfile = {
    ...profile,
    fullName: profile.fullName.trim() || String(row.full_name ?? ""),
    phone: profile.phone.trim() || String(row.phone ?? ""),
    linkedInUrl: profile.linkedInUrl.trim() || String(row.linkedin_url ?? ""),
    targetRole: profile.targetRole?.trim() || String(row.job_title ?? ""),
    yearsOfExperience:
      profile.yearsOfExperience?.trim() ||
      (Number.isFinite(legacyYears) && legacyYears > 0 ? String(legacyYears) : ""),
    skills: profile.skills?.length ? profile.skills : legacySkills,
    defaultCvLabel:
      profile.defaultCvLabel.trim() || String(row.cv_filename ?? ""),
  };
  return {
    ...merged,
    resumeProfiles: merged.resumeProfiles?.map((resumeProfile) => {
      const candidateName = resolveCandidateName(
        merged.fullName,
        resumeProfile.resumeText,
      );
      return {
        ...resumeProfile,
        resumeText: normaliseResumeText(resumeProfile.resumeText),
        coverLetter: candidateName
          ? normaliseCoverLetterSignoff(resumeProfile.coverLetter, candidateName)
          : normaliseCoverLetterTerminology(
              stripCoverLetterSignoff(resumeProfile.coverLetter),
            ),
      };
    }),
  };
}

function mapEvent(row: DbRow): ApplicationEvent {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    type: row.event_type as ApplicationEvent["type"],
    label: String(row.label ?? "Application updated"),
    createdAt: String(row.created_at),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : undefined,
  };
}

function mapApplication(
  row: DbRow,
  events: ApplicationEvent[],
  submission?: DbRow,
): ApplicationRecord {
  const applicationEvents = events.filter(
    (event) => event.applicationId === String(row.id),
  );
  const eventAttention = [...applicationEvents]
    .reverse()
    .find((event) => event.metadata?.attention)?.metadata?.attention;
  const submissionAttention = submissionAttentionFromRow(submission);
  const latestAttention = submissionAttention ?? eventAttention;
  return {
    id: String(row.id),
    job: row.job_snapshot as JobDetail,
    status: row.status as ApplicationRecord["status"],
    matchScore: Number(row.match_score ?? 0),
    matchedKeywords: (row.matched_keywords as string[]) ?? [],
    missingKeywords: (row.missing_keywords as string[]) ?? [],
    sourceCvText: normaliseResumeText(String(row.source_cv_text ?? "")),
    tailoredCvText: normaliseResumeText(String(row.tailored_cv_text ?? "")),
    resumeVersionLabel: String(row.resume_version_label ?? "Application Resume"),
    coverLetter: String(row.cover_letter ?? ""),
    questions: (row.screening_answers as ApplicationRecord["questions"]) ?? [],
    truthApproved: Boolean(row.truth_approved),
    materialsApproved: Boolean(row.materials_approved),
    submissionApproved: Boolean(row.submission_approved),
    mode: row.mode as ApplicationRecord["mode"],
    receipt: (row.receipt as ApplicationRecord["receipt"]) ?? null,
    attention:
      row.status === "needs_review" &&
      latestAttention &&
      typeof latestAttention === "object"
        ? (latestAttention as ApplicationRecord["attention"])
        : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    events: applicationEvents,
  };
}

function mapMessage(row: DbRow): InboxMessage {
  return {
    id: String(row.id),
    applicationId: row.application_id ? String(row.application_id) : null,
    from: String(row.sender),
    subject: String(row.subject ?? ""),
    preview: String(row.preview ?? ""),
    body: String(row.body_text ?? ""),
    classification: row.classification as InboxMessage["classification"],
    receivedAt: String(row.received_at),
    read: Boolean(row.is_read),
  };
}

export async function loadCloudWorkspace(
  userId: string,
  email: string,
): Promise<WorkspaceState> {
  const supabase = getSupabase();
  const [
    profileResult,
    applicationsResult,
    eventsResult,
    aliasResult,
    messagesResult,
    rulesResult,
    runsResult,
    entitlementResult,
    submissionsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("application_profile, full_name, skills, phone, linkedin_url, job_title, years_experience, cv_filename")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("application_packets")
      .select("id, job_snapshot, status, match_score, matched_keywords, missing_keywords, source_cv_text, tailored_cv_text, resume_version_label, cover_letter, screening_answers, truth_approved, materials_approved, submission_approved, mode, receipt, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(CLOUD_APPLICATION_LIMIT),
    supabase
      .from("application_events")
      .select("id, application_id, event_type, label, metadata, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(CLOUD_EVENT_LIMIT),
    supabase
      .from("inbox_aliases")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("inbox_messages")
      .select("id, application_id, sender, subject, preview, body_text, classification, received_at, is_read")
      .eq("user_id", userId)
      .order("received_at", { ascending: false })
      .limit(CLOUD_MESSAGE_LIMIT),
    supabase
      .from("automation_rules")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("automation_runs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("user_entitlements")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("application_submissions")
      .select("application_id, status, error_code, receipt, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(CLOUD_SUBMISSION_LIMIT),
  ]);

  const failure = [
    profileResult,
    applicationsResult,
    eventsResult,
    aliasResult,
    messagesResult,
    rulesResult,
    runsResult,
    entitlementResult,
    submissionsResult,
  ].find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);

  const state = createBlankCloudWorkspaceState(email);
  const events = ((eventsResult.data ?? []) as DbRow[])
    .map(mapEvent)
    .reverse();
  const profileRow = profileResult.data as DbRow | null;
  const aliasRow = aliasResult.data as DbRow | null;
  const rulesRow = rulesResult.data as DbRow | null;
  const entitlementRow = entitlementResult.data as DbRow | null;
  const submissionMap = new Map<string, DbRow>();
  for (const row of (submissionsResult.data ?? []) as DbRow[]) {
    const applicationId = String(row.application_id ?? "");
    if (applicationId && !submissionMap.has(applicationId))
      submissionMap.set(applicationId, row);
  }

  const automation: AutomationRules = rulesRow
    ? {
        enabled: Boolean(rulesRow.enabled),
        dryRunOnly: true,
        minimumMatch: Number(rulesRow.minimum_match ?? 70),
        minimumDayRate: Number(rulesRow.minimum_day_rate ?? 0),
        ir35: (rulesRow.ir35_statuses as AutomationRules["ir35"]) ?? [
          "outside",
        ],
        workplaces: (rulesRow.workplaces as AutomationRules["workplaces"]) ?? [
          "remote",
          "hybrid",
        ],
        dailyLimit: clampDailyApplicationLimit(rulesRow.daily_limit, {
          plan: entitlementRow?.plan === "pro" ? "pro" : "free",
          billingState: entitlementRow?.billing_state === "active" ? "active" : "not_connected",
        }),
        prepareCoverLetter: Boolean(rulesRow.prepare_cover_letter ?? true),
        requireHumanApproval: true,
        excludedCompanies: (rulesRow.excluded_companies as string[]) ?? [],
      }
    : state.automation;

  const runs: AutomationPreview[] = ((runsResult.data ?? []) as DbRow[]).map(
    (row) => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      matchingJobIds: (row.matching_job_ids as string[]) ?? [],
      skipped: (row.skipped as AutomationPreview["skipped"]) ?? [],
    }),
  );

  const inbox: InboxSettings = aliasRow
    ? {
        alias: String(aliasRow.alias),
        forwardingEmail: String(aliasRow.forwarding_email ?? email),
        forwardingEnabled: Boolean(aliasRow.forwarding_enabled),
        providerState:
          aliasRow.provider_state === "connected"
            ? "connected"
            : "not_connected",
      }
    : state.inbox;

  const entitlement: Entitlement = entitlementRow
    ? {
        plan: entitlementRow.plan === "pro" ? "pro" : "free",
        preparationCredits: Number(entitlementRow.preparation_credits ?? 0),
        billingState:
          entitlementRow.billing_state === "active"
            ? "active"
            : entitlementRow.billing_state === "sandbox"
              ? "sandbox"
              : entitlementRow.billing_state === "past_due"
                ? "past_due"
                : entitlementRow.billing_state === "cancelled"
                  ? "cancelled"
                  : "not_connected",
      }
    : state.entitlement;

  const loadedProfile = profileFromRow(profileRow, state.profile);
  const mailboxState = loadedProfile.mailboxState ?? {};

  return {
    ...state,
    profile: loadedProfile,
    applications: ((applicationsResult.data ?? []) as DbRow[]).map((row) =>
      mapApplication(row, events, submissionMap.get(String(row.id))),
    ),
    messages: ((messagesResult.data ?? []) as DbRow[])
      .map(mapMessage)
      .map((message) => ({
        ...message,
        folder: mailboxState[message.id]?.folder ?? "inbox",
        starred: mailboxState[message.id]?.starred ?? false,
      }))
      .filter(
        (message) =>
          !isUnsolicitedJobMarketingMessage(
            message.subject,
            message.body,
            message.from,
          ),
      ),
    automation,
    automationRuns: runs,
    inbox,
    entitlement,
  };
}

export async function saveCloudWorkspace(
  userId: string,
  state: WorkspaceState,
): Promise<void> {
  const supabase = getSupabase();
  const activeResume =
    state.profile.resumeProfiles?.find(
      (item) => item.id === state.profile.activeResumeProfileId,
    ) ??
    state.profile.resumeProfiles?.find((item) => item.isDefault) ??
    state.profile.resumeProfiles?.[0];
  const targetRate = Number(
    state.profile.targetDayRate?.replace(/[^\d.]/g, "") ?? "",
  );
  const yearsExperience = Number.parseInt(
    state.profile.yearsOfExperience ?? "",
    10,
  );
  const profileResult = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      application_profile: state.profile,
      full_name: state.profile.fullName.trim(),
      skills: state.profile.skills ?? [],
      target_rate_min:
        Number.isFinite(targetRate) && targetRate > 0 ? targetRate : null,
      phone: state.profile.phone.trim() || null,
      linkedin_url: state.profile.linkedInUrl.trim() || null,
      job_title: state.profile.targetRole?.trim() || null,
      years_experience:
        Number.isFinite(yearsExperience) && yearsExperience > 0
          ? yearsExperience
          : null,
      cv_filename: activeResume?.resumeText.trim()
        ? activeResume.name
        : null,
      updated_at: new Date().toISOString(),
    });
  if (profileResult.error) throw new Error(profileResult.error.message);

  if (state.applications.length > 0) {
    // Provider receipts and post-submission states are server-owned. The
    // browser persists only candidate-reviewed drafts.
    const applicationRows = state.applications
      .filter((application) =>
        ["draft", "ready", "needs_review"].includes(application.status),
      )
      .map((application) => ({
        id: application.id,
        user_id: userId,
        job_id: application.job.id,
        job_snapshot: application.job,
        status: application.status,
        match_score: application.matchScore,
        resume_version_label: application.resumeVersionLabel,
        source_cv_text: normaliseResumeText(application.sourceCvText),
        tailored_cv_text: normaliseResumeText(application.tailoredCvText),
        cover_letter: application.coverLetter,
        screening_answers: application.questions,
        matched_keywords: application.matchedKeywords,
        missing_keywords: application.missingKeywords,
        truth_approved: application.truthApproved,
        materials_approved: application.materialsApproved,
        submission_approved: application.submissionApproved,
        idempotency_key: application.id,
        created_at: application.createdAt,
        updated_at: application.updatedAt,
      }));
    if (applicationRows.length > 0) {
      const applicationResult = await supabase
        .from("application_packets")
        .upsert(applicationRows);
      if (applicationResult.error)
        throw new Error(applicationResult.error.message);
    }

    const eventRows = state.applications.flatMap((application) =>
      application.events
        .filter((event) =>
          ["created", "prepared", "approved", "note"].includes(event.type),
        )
        .map((event) => ({
          id: event.id,
          user_id: userId,
          application_id: application.id,
          event_type: event.type,
          label: event.label,
          metadata: event.metadata ?? {},
          idempotency_key: event.id,
          created_at: event.createdAt,
        })),
    );
    if (eventRows.length > 0) {
      const eventResult = await supabase
        .from("application_events")
        .upsert(eventRows, { onConflict: "id", ignoreDuplicates: true });
      if (eventResult.error) throw new Error(eventResult.error.message);
    }
  }

  // Private application identities are server-managed. The browser may read
  // its own alias but must never choose or mutate provider/forwarding fields.
  const rulesResult = await supabase
    .from("automation_rules")
    .upsert({
      user_id: userId,
      enabled: state.automation.enabled,
      dry_run_only: true,
      minimum_match: state.automation.minimumMatch,
      minimum_day_rate: state.automation.minimumDayRate,
      ir35_statuses: state.automation.ir35,
      workplaces: state.automation.workplaces,
      daily_limit: clampDailyApplicationLimit(state.automation.dailyLimit, state.entitlement),
      prepare_cover_letter: state.automation.prepareCoverLetter,
      require_human_approval: true,
      excluded_companies: state.automation.excludedCompanies,
      updated_at: new Date().toISOString(),
    });
  if (rulesResult.error) throw new Error(rulesResult.error.message);

  if (state.messages.length > 0) {
    const messageResults = await Promise.all(
      state.messages.map((message) =>
        supabase
          .from("inbox_messages")
          .update({ is_read: message.read })
          .eq("id", message.id)
          .eq("user_id", userId),
      ),
    );
    const failedMessage = messageResults.find((result) => result.error);
    if (failedMessage?.error) throw new Error(failedMessage.error.message);
  }

  if (state.automationRuns.length > 0) {
    const runsResult = await supabase.from("automation_runs").upsert(
      state.automationRuns.map((run) => ({
        id: run.id,
        user_id: userId,
        mode: "dry_run",
        matching_job_ids: run.matchingJobIds,
        skipped: run.skipped,
        created_at: run.createdAt,
      })),
    );
    if (runsResult.error) throw new Error(runsResult.error.message);
  }
}
