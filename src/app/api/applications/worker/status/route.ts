import {
  ApplicationWorkerRequestError,
  readSignedApplicationWorkerJson,
} from "@/lib/application-worker-request";
import {
  buildApplicationDeliveryReport,
  deliveryDestinationHost,
  readAllDeliveryRows,
} from "@/lib/application-delivery-status";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { applyRunnerExecution } from "@/lib/application-runner-selection";

export const runtime = "nodejs";
export const maxDuration = 60;

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

type StatusRequest = { action: "submission_status"; offset?: number; limit?: number; includeInventory?: boolean };

function validRequest(value: unknown): value is StatusRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return input.action === "submission_status" &&
    (input.offset === undefined || (Number.isInteger(input.offset) && Number(input.offset) >= 0 && Number(input.offset) <= 1_000_000)) &&
    (input.limit === undefined || (Number.isInteger(input.limit) && Number(input.limit) >= 1 && Number(input.limit) <= 1_000)) &&
    (input.includeInventory === undefined || typeof input.includeInventory === "boolean");
}

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = await readSignedApplicationWorkerJson(request, 4_000);
    if (!validRequest(parsed)) return Response.json(
      { error: "The submission status request is invalid." },
      { status: 400, headers: HEADERS },
    );
    const admin = getSupabaseAdmin();
    const asOf = new Date().toISOString();
    // A stable primary-key order and fixed creation cutoff prevent new rows
    // from moving the pagination boundary while the report is being read.
    const [packets, submissions, tasks, jobs, heartbeatResult] = await Promise.all([
      readAllDeliveryRows(async (from, to) => admin.from("application_packets")
        .select("id,job_id,job_snapshot,status,mode,screening_answers,truth_approved,materials_approved,submission_approved,receipt,created_at,updated_at")
        .lte("created_at", asOf).order("id", { ascending: true }).range(from, to)),
      readAllDeliveryRows(async (from, to) => admin.from("application_submissions")
        .select("id,application_id,status,provider_name,provider_submission_id,receipt,error_code,submitted_at,created_at,updated_at")
        .lte("created_at", asOf).order("id", { ascending: true }).range(from, to)),
      readAllDeliveryRows(async (from, to) => admin.from("application_worker_tasks")
        .select("id,application_id,status,attempts,destination,available_at,lease_expires_at,created_at,updated_at")
        .lte("created_at", asOf).order("id", { ascending: true }).range(from, to)),
      parsed.includeInventory === false ? Promise.resolve(null) :
        readAllDeliveryRows(async (from, to) => admin.from("jobs")
          .select("id,source_domain,ir35_status").is("expired_at", null)
          .lte("first_seen_at", asOf).order("id", { ascending: true }).range(from, to)),
      admin.from("application_worker_heartbeats")
        .select("last_seen_at,active,concurrency,completed,failed,version")
        .gte("last_seen_at", new Date(Date.parse(asOf) - 180_000).toISOString()),
    ]);
    if (heartbeatResult.error) throw heartbeatResult.error;
    const report = buildApplicationDeliveryReport({ packets, submissions, tasks, nowMs: Date.parse(asOf) });
    const verification = await admin.from("moderation_logs").select("created_at,summary")
      .eq("run_type", "cloud_worker_verification").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const offset = parsed.offset ?? 0;
    const limit = parsed.limit ?? 500;
    const bySource: Record<string, number> = {};
    const byIr35: Record<string, number> = {};
    for (const job of jobs ?? []) {
      const source = deliveryDestinationHost(job.source_domain) || "unknown";
      bySource[source] = (bySource[source] ?? 0) + 1;
      const status = ["inside", "outside"].includes(String(job.ir35_status)) ? String(job.ir35_status) : "unknown";
      byIr35[status] = (byIr35[status] ?? 0) + 1;
    }
    const heartbeats = heartbeatResult.data ?? [];
    return Response.json({
      ok: true,
      asOf,
      scanComplete: true,
      consistency: "Rows created by the report start are included; states are read from the live database during the scan.",
      ...report,
      rows: report.rows.slice(offset, offset + limit),
      pagination: {
        offset, limit,
        returned: Math.min(limit, Math.max(0, report.rows.length - offset)),
        nextOffset: offset + limit < report.rows.length ? offset + limit : null,
      },
      worker: {
        execution: applyRunnerExecution(),
        deviceRequired: applyRunnerExecution() === "external_worker",
        latestCloudVerification: verification.data || null,
        recentlyConnected: heartbeats.length,
        active: heartbeats.reduce((sum, worker) => sum + Number(worker.active || 0), 0),
        concurrency: heartbeats.reduce((sum, worker) => sum + Number(worker.concurrency || 0), 0),
        latestHeartbeatAt: heartbeats.map((worker) => String(worker.last_seen_at)).sort().at(-1) ?? null,
        recentConsumerVersions: heartbeats.map((worker) => ({ version: worker.version, lastSeenAt: worker.last_seen_at })),
      },
      inventory: jobs ? { active: jobs.length, bySource, byIr35, scanComplete: true } : null,
    }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ApplicationWorkerRequestError) return Response.json(
      { error: error.message }, { status: error.status, headers: HEADERS },
    );
    console.error("application_delivery_status_failed", {
      reason: error instanceof Error ? error.message.slice(0, 240) : "unknown",
    });
    return Response.json(
      { error: "The complete application delivery report could not be read." },
      { status: 500, headers: HEADERS },
    );
  }
}
