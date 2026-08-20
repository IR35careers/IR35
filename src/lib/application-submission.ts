import type { ApplicationQuestion, ContractorProfile } from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";

export interface SubmissionProviderConfig {
  endpoint: string;
  apiKey: string;
  name: string;
}

export interface SubmissionProviderPayload {
  applicationId: string;
  destination: string;
  job: JobDetail;
  candidate: ContractorProfile;
  resume: { label: string; text: string };
  coverLetter: string;
  screeningAnswers: Array<Pick<ApplicationQuestion, "label" | "answer" | "source">>;
}

export interface SubmissionProviderReceipt {
  providerSubmissionId: string;
  submittedAt: string;
  message: string;
}

export function submissionProviderConfig(): SubmissionProviderConfig | null {
  if (process.env.ENABLE_APPLICATION_SUBMISSION?.toLowerCase() !== "true") return null;
  const apiKey = process.env.APPLICATION_SUBMISSION_PROVIDER_API_KEY?.trim();
  const rawEndpoint = process.env.APPLICATION_SUBMISSION_PROVIDER_URL?.trim();
  if (!apiKey || !rawEndpoint) return null;
  try {
    const endpoint = new URL(rawEndpoint);
    if (endpoint.protocol !== "https:") return null;
    return { endpoint: endpoint.toString(), apiKey, name: process.env.APPLICATION_SUBMISSION_PROVIDER_NAME?.trim() || "Authorised submission provider" };
  } catch {
    return null;
  }
}

export async function submitWithProvider(payload: SubmissionProviderPayload, idempotencyKey: string): Promise<SubmissionProviderReceipt> {
  const config = submissionProviderConfig();
  if (!config) throw new Error("Submission provider is not configured.");
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
  const body = (await response.json().catch(() => null)) as { submission_id?: string; receipt_id?: string; submitted_at?: string; message?: string; error?: string } | null;
  if (!response.ok) throw new Error(body?.error || `Submission provider returned ${response.status}.`);
  const providerSubmissionId = body?.submission_id || body?.receipt_id;
  if (!providerSubmissionId) throw new Error("Submission provider did not return a receipt identifier.");
  const submittedAt = body?.submitted_at && Number.isFinite(new Date(body.submitted_at).getTime()) ? new Date(body.submitted_at).toISOString() : new Date().toISOString();
  return { providerSubmissionId, submittedAt, message: body?.message || "The provider accepted the approved application." };
}
