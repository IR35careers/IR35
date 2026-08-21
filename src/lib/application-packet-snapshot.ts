import type { JobDetail } from "@/lib/job-types";
import type { ApplicationQuestion, ApplicationRecord } from "@/lib/workspace/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REMOTE_TYPES = new Set<JobDetail["remote_type"]>(["remote", "hybrid", "onsite", "unknown"]);
const IR35_STATUSES = new Set<JobDetail["ir35_status"]>(["inside", "outside", "unknown"]);
const IR35_CONFIDENCE = new Set<JobDetail["ir35_confidence"]>(["high", "medium", "low"]);
const RATE_TYPES = new Set<JobDetail["rate_type"]>(["daily", "hourly", "annual", "unknown"]);
const QUESTION_SOURCES = new Set<ApplicationQuestion["source"]>(["profile", "user", "job"]);

type UnknownRecord = Record<string, unknown>;

export class InvalidApplicationPacketError extends Error {
  constructor(message = "The approved application packet is invalid. Review it and try again.") {
    super(message);
    this.name = "InvalidApplicationPacketError";
  }
}

function object(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidApplicationPacketError();
  return value as UnknownRecord;
}

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string") {
    if (required) throw new InvalidApplicationPacketError();
    return "";
  }
  const result = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if ((required && !result) || result.length > max) throw new InvalidApplicationPacketError();
  return result;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 10_000_000) throw new InvalidApplicationPacketError();
  return value;
}

function iso(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new InvalidApplicationPacketError();
  return value.map((item) => text(item, maxLength, true));
}

function jobSnapshot(value: unknown, now: string): JobDetail {
  const source = object(value);
  const id = text(source.id, 36, true);
  if (!UUID.test(id)) throw new InvalidApplicationPacketError();
  const applyUrl = text(source.apply_url, 2_000, true);
  let parsed: URL;
  try {
    parsed = new URL(applyUrl);
  } catch {
    throw new InvalidApplicationPacketError();
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new InvalidApplicationPacketError();

  const remoteType = REMOTE_TYPES.has(source.remote_type as JobDetail["remote_type"])
    ? source.remote_type as JobDetail["remote_type"]
    : "unknown";
  const ir35Status = IR35_STATUSES.has(source.ir35_status as JobDetail["ir35_status"])
    ? source.ir35_status as JobDetail["ir35_status"]
    : "unknown";
  const ir35Confidence = IR35_CONFIDENCE.has(source.ir35_confidence as JobDetail["ir35_confidence"])
    ? source.ir35_confidence as JobDetail["ir35_confidence"]
    : "low";
  const rateType = RATE_TYPES.has(source.rate_type as JobDetail["rate_type"])
    ? source.rate_type as JobDetail["rate_type"]
    : "unknown";

  return {
    id,
    title: text(source.title, 300, true),
    company_name: text(source.company_name, 300, true),
    location: text(source.location, 300),
    remote_type: remoteType,
    ir35_status: ir35Status,
    ir35_confidence: ir35Confidence,
    rate_min: optionalNumber(source.rate_min),
    rate_max: optionalNumber(source.rate_max),
    rate_currency: source.rate_currency === null || source.rate_currency === undefined ? null : text(source.rate_currency, 10),
    rate_type: rateType,
    skills: strings(source.skills ?? [], 100, 120),
    posted_at: source.posted_at === null || source.posted_at === undefined ? null : iso(source.posted_at, now),
    first_seen_at: iso(source.first_seen_at, now),
    last_seen_at: source.last_seen_at === undefined || source.last_seen_at === null ? undefined : iso(source.last_seen_at, now),
    description: text(source.description, 150_000),
    apply_url: parsed.toString(),
    source_domain: text(source.source_domain, 300) || parsed.hostname,
  };
}

function questions(value: unknown): ApplicationQuestion[] {
  if (!Array.isArray(value) || value.length > 100) throw new InvalidApplicationPacketError();
  return value.map((item) => {
    const source = object(item);
    const answer = text(source.answer, 10_000);
    const required = Boolean(source.required);
    const reviewed = Boolean(source.reviewed);
    const question: ApplicationQuestion = {
      id: text(source.id, 200, true),
      label: text(source.label, 1_000, true),
      answer,
      required,
      reviewed,
      source: QUESTION_SOURCES.has(source.source as ApplicationQuestion["source"])
        ? source.source as ApplicationQuestion["source"]
        : "job",
    };
    if (required && (!reviewed || !answer)) throw new InvalidApplicationPacketError("Answer and review every required employer question before applying.");
    return question;
  });
}

export function normaliseApprovedApplicationPacket(value: unknown, applicationId: string, now = new Date().toISOString()): ApplicationRecord {
  const source = object(value);
  const id = text(source.id, 36, true);
  if (!UUID.test(applicationId) || id !== applicationId) throw new InvalidApplicationPacketError();
  if (!source.truthApproved || !source.materialsApproved || !source.submissionApproved) {
    throw new InvalidApplicationPacketError("Complete all final approval checks before applying.");
  }

  const sourceCvText = text(source.sourceCvText, 250_000);
  const tailoredCvText = text(source.tailoredCvText, 250_000);
  if (!sourceCvText && !tailoredCvText) throw new InvalidApplicationPacketError("Add a CV before applying.");

  return {
    id,
    job: jobSnapshot(source.job, now),
    status: "ready",
    matchScore: typeof source.matchScore === "number" && Number.isFinite(source.matchScore)
      ? Math.max(0, Math.min(100, Math.round(source.matchScore)))
      : 0,
    matchedKeywords: strings(source.matchedKeywords ?? [], 100, 120),
    missingKeywords: strings(source.missingKeywords ?? [], 100, 120),
    sourceCvText,
    tailoredCvText,
    resumeVersionLabel: text(source.resumeVersionLabel, 300) || "Application CV",
    coverLetter: text(source.coverLetter, 50_000),
    questions: questions(source.questions ?? []),
    truthApproved: true,
    materialsApproved: true,
    submissionApproved: true,
    mode: "dry_run",
    receipt: null,
    createdAt: iso(source.createdAt, now),
    updatedAt: now,
    events: [],
  };
}

export function approvedApplicationPacketRow(packet: ApplicationRecord, userId: string, trustedJob: JobDetail): UnknownRecord {
  return {
    id: packet.id,
    user_id: userId,
    job_id: trustedJob.id,
    job_snapshot: trustedJob,
    status: "ready",
    mode: "dry_run",
    match_score: packet.matchScore,
    resume_version_label: packet.resumeVersionLabel,
    source_cv_text: packet.sourceCvText,
    tailored_cv_text: packet.tailoredCvText,
    cover_letter: packet.coverLetter,
    screening_answers: packet.questions,
    matched_keywords: packet.matchedKeywords,
    missing_keywords: packet.missingKeywords,
    truth_approved: true,
    materials_approved: true,
    submission_approved: true,
    receipt: null,
    idempotency_key: packet.id,
    created_at: packet.createdAt,
    updated_at: packet.updatedAt,
  };
}
