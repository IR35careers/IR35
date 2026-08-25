import {
  ApplicationWorkerRequestError,
  readSignedApplicationWorkerJson,
} from "@/lib/application-worker-request";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveApplicationTaskDestination } from "@/lib/application-worker-destination";

export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const RECOVERABLE_ACTIONS = new Set([
  "unsupported_form",
  "runner_timeout",
  "employer_login",
]);

type RecoveryRequest = {
  mode: "preview" | "requeue";
  applicationId?: string;
  destinationHost: string;
  workerVersion: string;
};

function validRequest(value: unknown): value is RecoveryRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return Boolean(
    (input.mode === "preview" || input.mode === "requeue") &&
    (input.applicationId === undefined ||
      (typeof input.applicationId === "string" &&
        /^[0-9a-f-]{36}$/i.test(input.applicationId))) &&
    (input.mode !== "requeue" || typeof input.applicationId === "string") &&
    typeof input.destinationHost === "string" &&
    /^[a-z0-9.-]{3,253}$/i.test(input.destinationHost) &&
    typeof input.workerVersion === "string" &&
    /^[a-z0-9._-]{3,80}$/i.test(input.workerVersion),
  );
}

function hostname(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function safeStrings(
  value: unknown,
  limit: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, limit)
    .map((entry) => entry.slice(0, maxLength));
}

function safeDiagnostic(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const diagnostic = value as Record<string, unknown>;
  const actions = Array.isArray(diagnostic.actions)
    ? diagnostic.actions.slice(0, 30).map((entry) => {
        const action =
          entry && typeof entry === "object"
            ? (entry as Record<string, unknown>)
            : {};
        return {
          label: String(action.label ?? "").slice(0, 180),
          enabled: action.enabled === true,
          role: String(action.role ?? "").slice(0, 60),
        };
      })
    : [];
  const controls = Array.isArray(diagnostic.controls)
    ? diagnostic.controls.slice(0, 80).map((entry) => {
        const control =
          entry && typeof entry === "object"
            ? (entry as Record<string, unknown>)
            : {};
        return {
          label: String(control.label ?? "").slice(0, 180),
          type: String(control.type ?? "").slice(0, 60),
          required: control.required === true,
          completed: control.completed === true,
          valid: control.valid === true,
        };
      })
    : [];
  return {
    title: String(diagnostic.title ?? "").slice(0, 160),
    headings: safeStrings(diagnostic.headings, 20, 180),
    actions,
    controls,
    blockedHosts: safeStrings(diagnostic.blockedHosts, 30, 253),
    networkFailures: safeStrings(diagnostic.networkFailures, 30, 300),
    messages: safeStrings(diagnostic.messages, 30, 300),
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = await readSignedApplicationWorkerJson(request, 10_000);
    if (!validRequest(parsed))
      return Response.json(
        { error: "The recovery request is invalid." },
        { status: 400, headers: HEADERS },
      );

    const supabase = getSupabaseAdmin();
    const submissionsResult = await supabase
      .from("application_submissions")
      .select(
        "id, user_id, application_id, idempotency_key, status, error_code, receipt, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(100);
    if (submissionsResult.error) throw submissionsResult.error;

    const inspectedSubmissions = submissionsResult.data ?? [];
    const submissions = inspectedSubmissions.filter((row) => {
      const receipt = row.receipt as Record<string, unknown> | null;
      return RECOVERABLE_ACTIONS.has(String(receipt?.action ?? ""));
    });
    const applicationIds = [
      ...new Set(inspectedSubmissions.map((row) => row.application_id)),
    ];

    const tasksResult = applicationIds.length
      ? await supabase
          .from("application_worker_tasks")
          .select(
            "id, user_id, application_id, idempotency_key, destination, callback_url, status",
          )
          .in("application_id", applicationIds)
      : { data: [], error: null };
    if (tasksResult.error) throw tasksResult.error;
    const tasksByApplication = new Map(
      (tasksResult.data ?? []).map((task) => [task.application_id, task]),
    );
    const candidates = submissions
      .map((submission) => ({
        submission,
        task: tasksByApplication.get(submission.application_id),
        destination: resolveApplicationTaskDestination({
          taskDestination: tasksByApplication.get(submission.application_id)
            ?.destination,
          receiptDestination: (
            submission.receipt as Record<string, unknown> | null
          )?.destination,
        }),
      }))
      .filter(
        (entry) =>
          entry.task &&
          entry.task.status === "needs_user" &&
          hostname(String(entry.destination ?? "")) ===
            parsed.destinationHost.toLowerCase(),
      );

    if (parsed.mode === "preview")
      return Response.json(
        {
          ok: true,
          candidates: candidates.map(({ submission, task, destination }) => ({
            applicationId: submission.application_id,
            action: String(
              (submission.receipt as Record<string, unknown> | null)?.action ??
                "",
            ),
            submissionStatus: submission.status,
            errorCode: submission.error_code,
            taskStatus: task?.status ?? "missing",
            destination: destination ?? "",
          })),
          diagnostics: {
            submissionsInspected: inspectedSubmissions.length,
            recoverableSubmissions: submissions.length,
            tasksInspected: tasksResult.data?.length ?? 0,
            recent: inspectedSubmissions.slice(0, 20).map((submission) => {
              const receipt = submission.receipt as Record<
                string,
                unknown
              > | null;
              const review =
                receipt?.review && typeof receipt.review === "object"
                  ? (receipt.review as Record<string, unknown>)
                  : null;
              const task = tasksByApplication.get(submission.application_id);
              return {
                applicationId: submission.application_id,
                action: String(receipt?.action ?? ""),
                message: String(receipt?.message ?? "").slice(0, 500),
                receiptState: String(receipt?.state ?? ""),
                receiptDestinationHost: hostname(
                  String(receipt?.destination ?? ""),
                ),
                submissionStatus: submission.status,
                errorCode: submission.error_code,
                taskStatus: task?.status ?? "missing",
                taskDestinationHost: hostname(String(task?.destination ?? "")),
                diagnostic: safeDiagnostic(review?.diagnostic),
              };
            }),
          },
          requeued: 0,
        },
        { headers: HEADERS },
      );

    const selected = candidates.find(
      ({ submission }) => submission.application_id === parsed.applicationId,
    );
    if (!selected?.task || !selected.destination)
      return Response.json(
        { error: "No matching stopped application was found." },
        { status: 404, headers: HEADERS },
      );

    const packetResult = await supabase
      .from("application_packets")
      .select(
        "screening_answers, truth_approved, materials_approved, submission_approved",
      )
      .eq("id", selected.submission.application_id)
      .eq("user_id", selected.submission.user_id)
      .maybeSingle();
    if (packetResult.error) throw packetResult.error;
    const packet = packetResult.data as {
      screening_answers?: Array<Record<string, unknown>>;
      truth_approved?: boolean;
      materials_approved?: boolean;
      submission_approved?: boolean;
    } | null;
    const questionsReady = (packet?.screening_answers ?? []).every(
      (question) =>
        !question.required ||
        (question.reviewed === true && String(question.answer ?? "").trim()),
    );
    if (
      !packet?.truth_approved ||
      !packet.materials_approved ||
      !packet.submission_approved ||
      !questionsReady
    )
      return Response.json(
        { error: "The approved application packet is no longer complete." },
        { status: 409, headers: HEADERS },
      );

    const now = new Date().toISOString();
    const [taskUpdate, submissionUpdate, packetUpdate, eventUpdate] =
      await Promise.all([
        supabase
          .from("application_worker_tasks")
          .update({
            destination: selected.destination,
            status: "queued",
            attempts: 0,
            available_at: now,
            lease_owner: null,
            lease_expires_at: null,
            last_error: null,
            completed_at: null,
          })
          .eq("id", selected.task.id),
        supabase
          .from("application_submissions")
          .update({
            status: "processing",
            error_code: null,
            receipt: {
              state: "processing",
              message:
                "The approved application is retrying with the latest employer portal adapter.",
            },
            updated_at: now,
          })
          .eq("id", selected.submission.id),
        supabase
          .from("application_packets")
          .update({
            status: "ready",
            submission_approved: true,
            updated_at: now,
          })
          .eq("id", selected.submission.application_id)
          .eq("user_id", selected.submission.user_id),
        supabase.from("application_events").upsert(
          {
            user_id: selected.submission.user_id,
            application_id: selected.submission.application_id,
            event_type: "status_changed",
            label: "Application requeued after employer portal update",
            idempotency_key: `submit:${selected.submission.application_id}:adapter:${parsed.workerVersion}`,
            metadata: {
              recoveredBy: "application_worker",
              reason: "portal_adapter_updated",
              workerVersion: parsed.workerVersion,
            },
          },
          { onConflict: "user_id,idempotency_key", ignoreDuplicates: true },
        ),
      ]);
    const error =
      taskUpdate.error ||
      submissionUpdate.error ||
      packetUpdate.error ||
      eventUpdate.error;
    if (error) throw error;
    return Response.json(
      {
        ok: true,
        applicationId: selected.submission.application_id,
        requeued: 1,
      },
      { headers: HEADERS },
    );
  } catch (error) {
    if (error instanceof ApplicationWorkerRequestError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: HEADERS },
      );
    console.error("application_worker_recovery_failed", {
      reason: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return Response.json(
      { error: "The stopped application could not be recovered." },
      { status: 500, headers: HEADERS },
    );
  }
}
