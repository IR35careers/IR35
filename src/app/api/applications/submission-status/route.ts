import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { applicationLifecycleSchema } from "@/lib/application-lifecycle";
import { submissionAttentionFromRow } from "@/lib/workspace/submission-attention";

export const runtime = "nodejs";
export const maxDuration = 15;
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Status is a read, not a command. No requeue, browser, provider call or writes. */
export async function GET(request: Request): Promise<Response> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: HEADERS });
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("applicationId"));
  if (!id.success) return Response.json({ error: "A valid application is required." }, { status: 400, headers: HEADERS });
  try {
    // Owner JWT + RLS rather than the service-role key for this read-only route.
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await client.auth.getUser(token);
    if (!auth.data.user || auth.error) return Response.json({ error: "Sign in again to view this application." }, { status: 401, headers: HEADERS });
    const [packet, submission] = await Promise.all([
      client.from("application_packets").select("id,status,delivery_status,delivery_version,failure_reason,error_detail,receipt,screening_answers,submission_approved,updated_at")
        .eq("id", id.data).eq("user_id", auth.data.user.id).maybeSingle(),
      client.from("application_submissions").select("status,error_code,receipt,updated_at")
        .eq("application_id", id.data).eq("user_id", auth.data.user.id).maybeSingle(),
    ]);
    if (packet.error || submission.error) throw new Error("Stored status unavailable");
    if (!packet.data) return Response.json({ error: "Application not found." }, { status: 404, headers: HEADERS });
    const lifecycle = applicationLifecycleSchema.parse(packet.data);
    const status = lifecycle.delivery_status;
    // `state` is compatibility transport only; every new surface uses deliveryStatus.
    const state = status === "submitted" ? "submitted" : status === "queued" || status === "submitting" ? "processing"
      : status === "needs_info" || status === "external_only" ? "needs_user" : status === "failed" ? "failed" : status;
    return Response.json({ state, deliveryStatus: status, deliveryVersion: lifecycle.delivery_version,
      failureReason: lifecycle.failure_reason, errorDetail: lifecycle.error_detail,
      receipt: packet.data.receipt, questions: packet.data.screening_answers,
      attention: submissionAttentionFromRow(submission.data),
      message: lifecycle.error_detail, updatedAt: packet.data.updated_at,
    }, { headers: HEADERS });
  } catch {
    return Response.json({ error: "The saved status is temporarily unavailable. No application was restarted." }, { status: 503, headers: HEADERS });
  }
}
