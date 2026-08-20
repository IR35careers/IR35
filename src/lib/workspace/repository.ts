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
import type { JobDetail } from "@/lib/job-types";

type DbRow = Record<string, unknown>;

function blankCloudState(email: string): WorkspaceState {
  const seed = createSeedWorkspaceState();
  return {
    ...seed,
    profile: { ...seed.profile, fullName: "", email, phone: "", limitedCompanyName: "", companyNumber: "", forwardingEmail: email },
    applications: [],
    messages: [],
    automationRuns: [],
    inbox: { alias: "Not created", forwardingEmail: email, forwardingEnabled: false, providerState: "not_connected" },
    entitlement: { plan: "free", preparationCredits: 25, billingState: "not_connected" },
  };
}

function asProfile(value: unknown, fallback: ContractorProfile): ContractorProfile {
  if (!value || typeof value !== "object") return fallback;
  return { ...fallback, ...(value as Partial<ContractorProfile>) };
}

function mapEvent(row: DbRow): ApplicationEvent {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    type: row.event_type as ApplicationEvent["type"],
    label: String(row.label ?? "Application updated"),
    createdAt: String(row.created_at),
  };
}

function mapApplication(row: DbRow, events: ApplicationEvent[]): ApplicationRecord {
  return {
    id: String(row.id),
    job: row.job_snapshot as JobDetail,
    status: row.status as ApplicationRecord["status"],
    matchScore: Number(row.match_score ?? 0),
    matchedKeywords: (row.matched_keywords as string[]) ?? [],
    missingKeywords: (row.missing_keywords as string[]) ?? [],
    sourceCvText: String(row.source_cv_text ?? ""),
    tailoredCvText: String(row.tailored_cv_text ?? ""),
    resumeVersionLabel: String(row.resume_version_label ?? "Application CV"),
    coverLetter: String(row.cover_letter ?? ""),
    questions: (row.screening_answers as ApplicationRecord["questions"]) ?? [],
    truthApproved: Boolean(row.truth_approved),
    materialsApproved: Boolean(row.materials_approved),
    submissionApproved: Boolean(row.submission_approved),
    mode: row.mode as ApplicationRecord["mode"],
    receipt: (row.receipt as ApplicationRecord["receipt"]) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    events: events.filter((event) => event.applicationId === String(row.id)),
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

export async function loadCloudWorkspace(userId: string, email: string): Promise<WorkspaceState> {
  const supabase = getSupabase();
  const [profileResult, applicationsResult, eventsResult, aliasResult, messagesResult, rulesResult, runsResult, entitlementResult] = await Promise.all([
    supabase.from("profiles").select("application_profile").eq("id", userId).maybeSingle(),
    supabase.from("application_packets").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    supabase.from("application_events").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    supabase.from("inbox_aliases").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("inbox_messages").select("*").eq("user_id", userId).order("received_at", { ascending: false }),
    supabase.from("automation_rules").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("automation_runs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    supabase.from("user_entitlements").select("*").eq("user_id", userId).maybeSingle(),
  ]);

  const failure = [profileResult, applicationsResult, eventsResult, aliasResult, messagesResult, rulesResult, runsResult, entitlementResult].find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);

  const state = blankCloudState(email);
  const events = ((eventsResult.data ?? []) as DbRow[]).map(mapEvent);
  const profileRow = profileResult.data as DbRow | null;
  const aliasRow = aliasResult.data as DbRow | null;
  const rulesRow = rulesResult.data as DbRow | null;
  const entitlementRow = entitlementResult.data as DbRow | null;

  const automation: AutomationRules = rulesRow ? {
    enabled: Boolean(rulesRow.enabled),
    dryRunOnly: true,
    minimumMatch: Number(rulesRow.minimum_match ?? 70),
    minimumDayRate: Number(rulesRow.minimum_day_rate ?? 0),
    ir35: (rulesRow.ir35_statuses as AutomationRules["ir35"]) ?? ["outside"],
    workplaces: (rulesRow.workplaces as AutomationRules["workplaces"]) ?? ["remote", "hybrid"],
    dailyLimit: Number(rulesRow.daily_limit ?? 5),
    prepareCoverLetter: Boolean(rulesRow.prepare_cover_letter ?? true),
    requireHumanApproval: true,
    excludedCompanies: (rulesRow.excluded_companies as string[]) ?? [],
  } : state.automation;

  const runs: AutomationPreview[] = ((runsResult.data ?? []) as DbRow[]).map((row) => ({
    id: String(row.id),
    createdAt: String(row.created_at),
    matchingJobIds: (row.matching_job_ids as string[]) ?? [],
    skipped: (row.skipped as AutomationPreview["skipped"]) ?? [],
  }));

  const inbox: InboxSettings = aliasRow ? {
    alias: String(aliasRow.alias),
    forwardingEmail: String(aliasRow.forwarding_email ?? email),
    forwardingEnabled: Boolean(aliasRow.forwarding_enabled),
    providerState: aliasRow.provider_state === "connected" ? "connected" : "not_connected",
  } : state.inbox;

  const entitlement: Entitlement = entitlementRow ? {
    plan: entitlementRow.plan === "pro" ? "pro" : "free",
    preparationCredits: Number(entitlementRow.preparation_credits ?? 0),
    billingState: entitlementRow.billing_state === "active" ? "active" : entitlementRow.billing_state === "sandbox" ? "sandbox" : entitlementRow.billing_state === "past_due" ? "past_due" : entitlementRow.billing_state === "cancelled" ? "cancelled" : "not_connected",
  } : state.entitlement;

  return {
    ...state,
    profile: asProfile(profileRow?.application_profile, state.profile),
    applications: ((applicationsResult.data ?? []) as DbRow[]).map((row) => mapApplication(row, events)),
    messages: ((messagesResult.data ?? []) as DbRow[]).map(mapMessage),
    automation,
    automationRuns: runs,
    inbox,
    entitlement,
  };
}

export async function saveCloudWorkspace(userId: string, state: WorkspaceState): Promise<void> {
  const supabase = getSupabase();
  const profileResult = await supabase.from("profiles").upsert({ id: userId, application_profile: state.profile, updated_at: new Date().toISOString() });
  if (profileResult.error) throw new Error(profileResult.error.message);

  if (state.applications.length > 0) {
    const applicationRows = state.applications.map((application) => ({
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
      idempotency_key: application.id,
      created_at: application.createdAt,
      updated_at: application.updatedAt,
    }));
    const applicationResult = await supabase.from("application_packets").upsert(applicationRows);
    if (applicationResult.error) throw new Error(applicationResult.error.message);

    const eventRows = state.applications.flatMap((application) => application.events.map((event) => ({
      id: event.id,
      user_id: userId,
      application_id: application.id,
      event_type: event.type,
      label: event.label,
      idempotency_key: event.id,
      created_at: event.createdAt,
    })));
    if (eventRows.length > 0) {
      const eventResult = await supabase.from("application_events").upsert(eventRows);
      if (eventResult.error) throw new Error(eventResult.error.message);
    }
  }

  const [aliasResult, rulesResult] = await Promise.all([
    state.inbox.alias === "Not created" ? Promise.resolve({ error: null }) : supabase.from("inbox_aliases").upsert({ user_id: userId, alias: state.inbox.alias, forwarding_email: state.inbox.forwardingEmail, forwarding_enabled: state.inbox.forwardingEnabled, provider_state: state.inbox.providerState === "connected" ? "connected" : "not_connected", updated_at: new Date().toISOString() }),
    supabase.from("automation_rules").upsert({ user_id: userId, enabled: state.automation.enabled, dry_run_only: true, minimum_match: state.automation.minimumMatch, minimum_day_rate: state.automation.minimumDayRate, ir35_statuses: state.automation.ir35, workplaces: state.automation.workplaces, daily_limit: state.automation.dailyLimit, prepare_cover_letter: state.automation.prepareCoverLetter, require_human_approval: true, excluded_companies: state.automation.excludedCompanies, updated_at: new Date().toISOString() }),
  ]);
  if (aliasResult.error) throw new Error(aliasResult.error.message);
  if (rulesResult.error) throw new Error(rulesResult.error.message);

  if (state.messages.length > 0) {
    const messageResults = await Promise.all(state.messages.map((message) => supabase.from("inbox_messages").update({ is_read: message.read }).eq("id", message.id).eq("user_id", userId)));
    const failedMessage = messageResults.find((result) => result.error);
    if (failedMessage?.error) throw new Error(failedMessage.error.message);
  }

  if (state.automationRuns.length > 0) {
    const runsResult = await supabase.from("automation_runs").upsert(state.automationRuns.map((run) => ({
      id: run.id,
      user_id: userId,
      mode: "dry_run",
      matching_job_ids: run.matchingJobIds,
      skipped: run.skipped,
      created_at: run.createdAt,
    })));
    if (runsResult.error) throw new Error(runsResult.error.message);
  }
}
