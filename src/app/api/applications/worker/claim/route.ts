import { applicationPortalPassword } from "@/lib/application-portal-account";
import { loadPortalSession } from "@/lib/application-portal-session";
import { applicationWorkerConfig } from "@/lib/application-worker-auth";
import {
  ApplicationWorkerRequestError,
  readSignedApplicationWorkerJson,
} from "@/lib/application-worker-request";
import type {
  ApplicationWorkerAssignment,
  ApplicationWorkerClaimRequest,
  ApplicationWorkerTaskRow,
} from "@/lib/application-worker-types";
import { normaliseCoverLetterSignoff, resolveCandidateName } from "@/lib/candidate-name";
import { applicationInboxAlias, ensureInboxAlias } from "@/lib/email/inbox-alias";
import { recoverPendingVerificationEmails } from "@/lib/email/recover-pending-verifications";
import { recoverDiscoverySourceApplications } from "@/lib/application-worker-source-recovery";
import type { JobDetail } from "@/lib/job-types";
import { normaliseResumeText } from "@/lib/resume/normalise-text";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  evaluateProfileReadiness,
  profileReadinessBlocker,
} from "@/lib/workspace/profile-readiness";
import type {
  ApplicationQuestion,
  ContractorProfile,
} from "@/lib/workspace/types";
import { enableEmployerAutomation } from "@/lib/application-automation-consent";

export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

type DbRow = Record<string, unknown>;

function validClaim(value: unknown): value is ApplicationWorkerClaimRequest {
  if (!value || typeof value !== "object") return false;
  const claim = value as Record<string, unknown>;
  return Boolean(
    typeof claim.workerId === "string" &&
      /^[a-z0-9_.-]{3,120}$/i.test(claim.workerId) &&
      typeof claim.startedAt === "string" &&
      Number.isFinite(new Date(claim.startedAt).getTime()) &&
      typeof claim.acceptTask === "boolean" &&
      Number.isInteger(claim.active) &&
      Number(claim.active) >= 0 &&
      Number(claim.active) <= 20 &&
      Number.isInteger(claim.concurrency) &&
      Number(claim.concurrency) >= 1 &&
      Number(claim.concurrency) <= 20 &&
      Number.isInteger(claim.completed) &&
      Number(claim.completed) >= 0 &&
      Number.isInteger(claim.failed) &&
      Number(claim.failed) >= 0 &&
      typeof claim.version === "string" &&
      claim.version.length <= 80,
  );
}

function approved(packet: DbRow): boolean {
  const questions = (packet.screening_answers as ApplicationQuestion[]) ?? [];
  return Boolean(
    packet.truth_approved &&
      packet.materials_approved &&
      packet.submission_approved &&
      questions.every(
        (question) =>
          !question.required || (question.reviewed && question.answer.trim()),
      ),
  );
}

function preflight(
  task: ApplicationWorkerTaskRow,
  message: string,
  action?: string,
): ApplicationWorkerAssignment {
  return { task, preflightError: message, preflightAction: action };
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!applicationWorkerConfig().enabled)
      return Response.json(
        { error: "The application worker is not enabled." },
        { status: 503, headers: HEADERS },
      );
    const parsed = await readSignedApplicationWorkerJson(request, 20_000);
    if (!validClaim(parsed))
      return Response.json(
        { error: "The worker claim is invalid." },
        { status: 400, headers: HEADERS },
      );

    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const heartbeatResult = await admin.from("application_worker_heartbeats").upsert({
        worker_id: parsed.workerId,
        last_seen_at: now,
        started_at: parsed.startedAt,
        active: parsed.active,
        concurrency: parsed.concurrency,
        completed: parsed.completed,
        failed: parsed.failed,
        version: parsed.version || "unknown",
      });
    if (heartbeatResult.error) throw new Error(heartbeatResult.error.message);
    if (!parsed.acceptTask) {
      await Promise.all([
        recoverPendingVerificationEmails({ admin }).catch((error) =>
          console.warn("worker_verification_recovery_failed", {
            reason:
              error instanceof Error ? error.message.slice(0, 240) : "unknown",
          }),
        ),
        recoverDiscoverySourceApplications({
          admin,
          workerVersion: parsed.version,
        }).catch((error) =>
          console.warn("worker_direct_source_recovery_failed", {
            reason:
              error instanceof Error ? error.message.slice(0, 240) : "unknown",
          }),
        ),
      ]);
      return Response.json({ assignment: null }, { headers: HEADERS });
    }
    const claimResult = await admin.rpc("claim_application_worker_task", {
      p_worker_id: parsed.workerId,
    });
    if (claimResult.error) throw new Error(claimResult.error.message);
    const task = (Array.isArray(claimResult.data)
      ? claimResult.data[0]
      : claimResult.data) as ApplicationWorkerTaskRow | null;
    if (!task)
      return Response.json({ assignment: null }, { headers: HEADERS });

    const [packetResult, profileResult, authResult] = await Promise.all([
      admin
        .from("application_packets")
        .select("*")
        .eq("id", task.application_id)
        .eq("user_id", task.user_id)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("application_profile")
        .eq("id", task.user_id)
        .maybeSingle(),
      admin.auth.admin.getUserById(task.user_id),
    ]);
    if (packetResult.error || profileResult.error || authResult.error)
      throw new Error(
        packetResult.error?.message ||
          profileResult.error?.message ||
          authResult.error?.message,
      );
    if (!packetResult.data)
      return Response.json(
        { assignment: preflight(task, "Application packet was not found.") },
        { headers: HEADERS },
      );
    const packet = packetResult.data as DbRow;
    if (!approved(packet))
      return Response.json(
        {
          assignment: preflight(
            task,
            "The approved application packet is no longer complete.",
          ),
        },
        { headers: HEADERS },
      );
    const job = packet.job_snapshot as JobDetail;
    const candidate = (profileResult.data?.application_profile ??
      {}) as ContractorProfile;
    const resumeText = normaliseResumeText(
      String(packet.tailored_cv_text || packet.source_cv_text || ""),
    );
    const readiness = evaluateProfileReadiness(candidate, resumeText);
    if (!readiness.complete) {
      const blocker = profileReadinessBlocker(readiness);
      return Response.json(
        {
          assignment: preflight(
            task,
            blocker?.message || "Complete your Application Profile.",
            blocker?.action,
          ),
        },
        { headers: HEADERS },
      );
    }
    const candidateName = resolveCandidateName(
      candidate.fullName || "",
      resumeText,
    );
    if (!candidateName)
      return Response.json(
        {
          assignment: preflight(
            task,
            "Add your full name to your Application Profile or Resume.",
          ),
        },
        { headers: HEADERS },
      );
    const accountEmail =
      authResult.data.user?.email ||
      candidate.forwardingEmail ||
      candidate.email ||
      "";
    const inbox = await ensureInboxAlias(admin, task.user_id, accountEmail, true);
    const submissionCandidate: ContractorProfile = enableEmployerAutomation({
      ...candidate,
      fullName: candidateName,
      email: inbox?.alias
        ? applicationInboxAlias(inbox.alias, task.application_id)
        : candidate.email || accountEmail,
    });
    const destination = new URL(task.destination);
    if (destination.protocol !== "https:")
      return Response.json(
        {
          assignment: preflight(
            task,
            "The employer application destination is no longer secure.",
          ),
        },
        { headers: HEADERS },
      );
    const screeningAnswers =
      (packet.screening_answers as ApplicationQuestion[]) ?? [];
    const assignment: ApplicationWorkerAssignment = {
      task,
      payload: {
        applicationId: task.application_id,
        destination: destination.toString(),
        job,
        candidate: submissionCandidate,
        resume: {
          label: String(packet.resume_version_label || "Application Resume"),
          text: resumeText,
        },
        coverLetter: normaliseCoverLetterSignoff(
          String(packet.cover_letter || ""),
          candidateName,
        ),
        screeningAnswers: screeningAnswers.map(({ label, answer, source }) => ({
          label,
          answer,
          source,
        })),
      },
      portalPassword: submissionCandidate.portalAccountConsent
        ? applicationPortalPassword(task.user_id, destination.toString())
        : undefined,
      portalSession: submissionCandidate.portalAccountConsent
        ? await loadPortalSession({
            admin,
            userId: task.user_id,
            applicationId: task.application_id,
          })
        : null,
    };
    return Response.json({ assignment }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ApplicationWorkerRequestError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: HEADERS },
      );
    console.error("application_worker_claim_failed", {
      reason: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return Response.json(
      { error: "The worker could not claim an application." },
      { status: 500, headers: HEADERS },
    );
  }
}
