import type { ApplicationQuestion, ContractorProfile } from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";
import { readJsonResponse } from "@/lib/security/response-body";

export type SubmissionProviderConfig =
  | { kind: "tsenta"; endpoint: string; apiKey: string; name: string }
  | { kind: "gateway"; endpoint: string; apiKey: string; name: string }
  | { kind: "native"; name: string };

export interface SubmissionProviderPayload {
  applicationId: string;
  destination: string;
  job: JobDetail;
  candidate: ContractorProfile;
  resume: { label: string; text: string; url?: string };
  coverLetter: string;
  screeningAnswers: Array<Pick<ApplicationQuestion, "label" | "answer" | "source">>;
}

export interface SubmissionProviderReceipt {
  state: "submitted" | "processing" | "needs_user";
  providerSubmissionId: string;
  submittedAt: string;
  message: string;
  review?: unknown;
}

interface TsentaApplication {
  id?: string;
  status?: "queued" | "running" | "needs_review" | "submitted" | "failed";
  failure_reason?: string | null;
  review?: unknown;
  updated_at?: string;
}

interface TsentaCandidate {
  profile_id?: string;
}

interface TsentaErrorEnvelope {
  error?: { code?: string; message?: string } | string;
}

type ProviderQuestion = Record<string, unknown>;

export function submissionProviderConfig(): SubmissionProviderConfig | null {
  if (process.env.ENABLE_APPLICATION_SUBMISSION?.toLowerCase() !== "true") return null;

  const tsentaKey = process.env.TSENTA_API_KEY?.trim();
  if (tsentaKey) {
    return {
      kind: "tsenta",
      endpoint: "https://api.autojobs.me/v1/",
      apiKey: tsentaKey,
      name: "One-click application service",
    };
  }

  const apiKey = process.env.APPLICATION_SUBMISSION_PROVIDER_API_KEY?.trim();
  const rawEndpoint = process.env.APPLICATION_SUBMISSION_PROVIDER_URL?.trim();
  if (apiKey && rawEndpoint) {
    try {
      const endpoint = new URL(rawEndpoint);
      if (endpoint.protocol === "https:") {
        return { kind: "gateway", endpoint: endpoint.toString(), apiKey, name: process.env.APPLICATION_SUBMISSION_PROVIDER_NAME?.trim() || "Authorised submission provider" };
      }
    } catch {
      // Fall through to the IR35Careers-owned browser runner.
    }
  }
  // The owned runner is the default delivery engine. OpenRouter improves
  // unfamiliar field-label mapping, but ordinary employer forms must not be
  // disabled merely because an AI key is absent or temporarily unavailable.
  return { kind: "native", name: "IR35Careers application runner" };
}

function clean(value: string | undefined): string {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function questionList(review: unknown): unknown[] {
  if (Array.isArray(review)) return review;
  if (!review || typeof review !== "object") return [];
  const record = review as Record<string, unknown>;
  for (const key of ["questions", "fields", "required_fields", "items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return Object.keys(record).some((key) => ["id", "key", "name", "label", "question", "prompt"].includes(key)) ? [record] : [];
}

function questionText(record: ProviderQuestion, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return clean(value).slice(0, 500);
  }
  return "";
}

/** Converts provider review payloads into the same owner-reviewed questions used by the workspace. */
export function providerReviewQuestions(review: unknown): ApplicationQuestion[] {
  return questionList(review).map((item, index) => {
    const record: ProviderQuestion = item && typeof item === "object" ? item as ProviderQuestion : { question: String(item ?? "") };
    const rawId = questionText(record, ["id", "question_id", "key", "name", "field"]);
    const label = questionText(record, ["label", "question", "prompt", "title", "name"]) || `Employer question ${index + 1}`;
    const answer = questionText(record, ["answer", "value", "default_value"]);
    return {
      id: `provider:${rawId || `question_${index + 1}`}`,
      label,
      answer,
      required: record.required !== false,
      source: "user" as const,
      reviewed: Boolean(answer),
    };
  }).filter((question, index, questions) => question.label.length > 0 && questions.findIndex((item) => item.id === question.id) === index);
}

function requiredCandidateFields(candidate: ContractorProfile, resumeUrl?: string): string[] {
  const nameParts = clean(candidate.fullName).split(" ").filter(Boolean);
  const checks: Array<[string, unknown]> = [
    ["full name", nameParts.length >= 2 ? "complete" : ""],
    ["email", clean(candidate.email)],
    ["phone", clean(candidate.phone)],
    ["address", clean(candidate.addressLine1)],
    ["town or city", clean(candidate.city)],
    ["postcode", clean(candidate.postcode)],
    ["country", clean(candidate.country)],
    ["age confirmation", candidate.isOver18],
    ["in-person work preference", candidate.canWorkInPerson],
    ["relocation preference", candidate.canRelocate],
    ["start availability", candidate.canStartImmediately],
    ["transport answer", candidate.hasTransportation],
    ["workplace accommodation answer", candidate.needsAccommodation],
    ["previous-employer answer", candidate.workedForCompanyBefore],
    ["government-clearance answer", candidate.hasGovernmentClearance],
    ["government-ties answer", candidate.hasGovernmentTies],
    ["education institution", clean(candidate.educationInstitution)],
    ["qualification", clean(candidate.educationQualification)],
    ["approved CV", resumeUrl],
  ];
  return checks.filter(([, value]) => value === "" || value === null || value === undefined).map(([label]) => label);
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = clean(fullName).split(" ").filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

function tsentaProfile(candidate: ContractorProfile) {
  const { firstName, lastName } = splitName(candidate.fullName);
  return {
    personalInformation: {
      firstName,
      lastName,
      isOver18: candidate.isOver18,
      email: clean(candidate.email),
      phone: clean(candidate.phone),
      address: clean(candidate.addressLine1),
      city: clean(candidate.city),
      state: clean(candidate.county) || clean(candidate.city),
      country: clean(candidate.country),
      zipCode: clean(candidate.postcode),
    },
    workAuthorization: {
      isAuthorizedToWork: candidate.rightToWork === "yes",
      needsSponsorship: candidate.rightToWork === "needs_sponsorship",
    },
    workPreferences: {
      canWorkInPerson: candidate.canWorkInPerson,
      canRelocate: candidate.canRelocate,
      canStartImmediately: candidate.canStartImmediately,
      hasTransportation: candidate.hasTransportation,
      hasAccommodations: candidate.needsAccommodation,
    },
    backgroundCheck: {
      hasWorkedForCompanyBefore: candidate.workedForCompanyBefore,
      hasGovernmentClearance: candidate.hasGovernmentClearance,
      hasGovernmentTies: candidate.hasGovernmentTies,
    },
    education: [{ university: clean(candidate.educationInstitution), degree: clean(candidate.educationQualification) }],
  };
}

async function tsentaRequest<T>(config: Extract<SubmissionProviderConfig, { kind: "tsenta" }>, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path.replace(/^\//, ""), config.endpoint), {
    ...init,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJsonResponse<T & TsentaErrorEnvelope>(response, 1_000_000).catch(() => null);
  if (!response.ok || !body) {
    const providerMessage = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new Error(providerMessage || "The employer application could not be completed.");
  }
  return body;
}

function tsentaReceipt(application: TsentaApplication, applicationId: string): SubmissionProviderReceipt {
  const updatedAt = application.updated_at && Number.isFinite(new Date(application.updated_at).getTime())
    ? new Date(application.updated_at).toISOString()
    : new Date().toISOString();
  if (application.status === "submitted") {
    return { state: "submitted", providerSubmissionId: applicationId, submittedAt: updatedAt, message: "Application submitted and confirmed by the employer application system." };
  }
  if (application.status === "needs_review") {
    return { state: "needs_user", providerSubmissionId: applicationId, submittedAt: updatedAt, review: application.review, message: "One or more employer questions need your answer before the application can be sent." };
  }
  if (application.status === "failed") {
    const reason = application.failure_reason?.replace(/_/g, " ") || "the employer form could not be completed";
    throw new Error(`Application stopped because ${reason}. Your approved materials are still saved.`);
  }
  return { state: "processing", providerSubmissionId: applicationId, submittedAt: updatedAt, message: "Application is being completed in the background." };
}

async function submitWithTsenta(config: Extract<SubmissionProviderConfig, { kind: "tsenta" }>, payload: SubmissionProviderPayload, idempotencyKey: string): Promise<SubmissionProviderReceipt> {
  const missing = requiredCandidateFields(payload.candidate, payload.resume.url);
  if (missing.length) throw new Error(`Complete your Application Profile before applying: ${missing.join(", ")}.`);

  const candidate = await tsentaRequest<TsentaCandidate>(config, "candidates", {
    method: "POST",
    headers: { "idempotency-key": `${idempotencyKey}:candidate` },
    body: JSON.stringify({ profile: tsentaProfile(payload.candidate), resume_url: payload.resume.url, email_mode: "candidate" }),
  });
  if (!candidate.profile_id) throw new Error("Your application profile could not be prepared.");

  let application = await tsentaRequest<TsentaApplication>(config, "applications", {
    method: "POST",
    headers: { "idempotency-key": `${idempotencyKey}:application` },
    body: JSON.stringify({ profile_id: candidate.profile_id, url: payload.destination }),
  });
  if (!application.id) throw new Error("The application service did not return a tracking reference.");
  const applicationId = application.id;

  for (let attempt = 0; attempt < 20 && (application.status === "queued" || application.status === "running"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    application = await tsentaRequest<TsentaApplication>(config, `applications/${applicationId}`);
  }

  return tsentaReceipt(application, applicationId);
}

async function submitWithGateway(config: Extract<SubmissionProviderConfig, { kind: "gateway" }>, payload: SubmissionProviderPayload, idempotencyKey: string): Promise<SubmissionProviderReceipt> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "user-agent": "IR35Careers-Submission/1.0",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await readJsonResponse<{ submission_id?: string; receipt_id?: string; submitted_at?: string; message?: string; error?: string }>(response, 1_000_000).catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Submission provider returned ${response.status}.`);
  const providerSubmissionId = body?.submission_id || body?.receipt_id;
  if (!providerSubmissionId) throw new Error("Submission provider did not return a receipt identifier.");
  const submittedAt = body?.submitted_at && Number.isFinite(new Date(body.submitted_at).getTime()) ? new Date(body.submitted_at).toISOString() : new Date().toISOString();
  return { state: "submitted", providerSubmissionId, submittedAt, message: body?.message || "The employer application was submitted." };
}

export async function submitWithProvider(payload: SubmissionProviderPayload, idempotencyKey: string): Promise<SubmissionProviderReceipt> {
  const config = submissionProviderConfig();
  if (!config) throw new Error("One-click applications are not configured.");
  if (config.kind === "tsenta") return submitWithTsenta(config, payload, idempotencyKey);
  if (config.kind === "gateway") return submitWithGateway(config, payload, idempotencyKey);
  const { runNativeApplication } = await import("@/lib/application-runner/run");
  return runNativeApplication(payload);
}

export async function checkSubmissionWithProvider(providerSubmissionId: string): Promise<SubmissionProviderReceipt> {
  const config = submissionProviderConfig();
  if (!config || config.kind !== "tsenta") {
    throw new Error("Application status is not available from the configured service.");
  }
  const application = await tsentaRequest<TsentaApplication>(config, `applications/${encodeURIComponent(providerSubmissionId)}`);
  return tsentaReceipt(application, providerSubmissionId);
}

export async function resumeSubmissionWithProvider(
  providerSubmissionId: string,
  questions: ApplicationQuestion[],
): Promise<SubmissionProviderReceipt> {
  const config = submissionProviderConfig();
  if (!config || config.kind !== "tsenta") {
    throw new Error("Application review is not available from the configured service.");
  }
  const answers = Object.fromEntries(
    questions
      .filter((question) => question.id.startsWith("provider:") && question.reviewed && question.answer.trim())
      .map((question) => [question.id.slice("provider:".length), question.answer.trim()]),
  );
  if (Object.keys(answers).length === 0) throw new Error("Answer the employer question before continuing.");
  let application = await tsentaRequest<TsentaApplication>(config, `applications/${encodeURIComponent(providerSubmissionId)}/review`, {
    method: "POST",
    body: JSON.stringify({ action: "approve", answers }),
  });
  for (let attempt = 0; attempt < 20 && (application.status === "queued" || application.status === "running"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    application = await tsentaRequest<TsentaApplication>(config, `applications/${encodeURIComponent(providerSubmissionId)}`);
  }
  return tsentaReceipt(application, providerSubmissionId);
}
