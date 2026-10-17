import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import {
  applicationNotificationPresentation,
  recordApplicationNotification,
  type ApplicationNotificationInput,
  type ApplicationNotificationKind,
} from "@/lib/email/application-notifications";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { JobDetail } from "@/lib/job-types";
import { isUnsolicitedJobMarketingMessage } from "@/lib/workspace/mail";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
type DbRow = Record<string, unknown>;

function notificationKind(label: string): ApplicationNotificationKind | null {
  if (/needs (?:your )?(?:answer|answers|attention)/i.test(label)) return "needs_attention";
  if (/submitted successfully/i.test(label)) return "submitted";
  if (/attempt stopped|ready to retry|submission issue/i.test(label)) return "submission_issue";
  return null;
}

function mapMessage(row: DbRow) {
  return {
    id: String(row.id),
    applicationId: row.application_id ? String(row.application_id) : null,
    from: String(row.sender ?? ""),
    subject: String(row.subject ?? ""),
    preview: String(row.preview ?? ""),
    body: String(row.body_text ?? ""),
    classification: String(row.classification ?? "other"),
    receivedAt: String(row.received_at),
    read: Boolean(row.is_read),
  };
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });

  try {
    const admin = getSupabaseAdmin();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return Response.json({ error: "Your session has expired." }, { status: 401, headers: NO_STORE });
    const userId = authData.user.id;
    const accountEmail = authData.user.email ?? "";
    const inbox = await ensureInboxAlias(admin, userId, accountEmail, true);

    const [{ data: packets, error: packetError }, { data: events, error: eventError }, { data: existing, error: existingError }] = await Promise.all([
      admin.from("application_packets").select("id, job_snapshot").eq("user_id", userId).limit(200),
      admin.from("application_events").select("id, application_id, label, idempotency_key, created_at").eq("user_id", userId).order("created_at", { ascending: true }).limit(500),
      admin.from("inbox_messages").select("application_id, subject").eq("user_id", userId).limit(1_000),
    ]);
    if (packetError || eventError || existingError) throw new Error(packetError?.message || eventError?.message || existingError?.message);

    const jobs = new Map((packets ?? []).map((row) => [String(row.id), row.job_snapshot as JobDetail]));
    const known = new Set((existing ?? []).map((row) => `${String(row.application_id ?? "")}:${String(row.subject ?? "")}`));
    let backfilled = 0;
    for (const row of events ?? []) {
      const kind = notificationKind(String(row.label ?? ""));
      const applicationId = String(row.application_id ?? "");
      const job = jobs.get(applicationId);
      if (!kind || !job) continue;
      const input: ApplicationNotificationInput = {
        kind,
        to: inbox?.forwardingEmail || accountEmail,
        userId,
        inboxAlias: inbox?.alias,
        jobTitle: job.title,
        companyName: job.company_name,
        applicationId,
        idempotencyKey: String(row.idempotency_key || row.id),
        occurredAt: String(row.created_at),
      };
      const subject = applicationNotificationPresentation(input).subject;
      const duplicateKey = `${applicationId}:${subject}`;
      if (known.has(duplicateKey)) continue;
      if (await recordApplicationNotification(input, admin)) {
        known.add(duplicateKey);
        backfilled += 1;
      }
    }

    const { data: messages, error: messageError } = await admin.from("inbox_messages")
      .select("id, application_id, sender, subject, preview, body_text, classification, received_at, is_read")
      .eq("user_id", userId)
      .order("received_at", { ascending: false })
      .limit(500);
    if (messageError) throw new Error(messageError.message);
    const visibleMessages = (messages ?? [])
      .map((row) => mapMessage(row as DbRow))
      .filter(
        (message) =>
          !isUnsolicitedJobMarketingMessage(
            message.subject,
            message.body,
            message.from,
          ),
      );
    return Response.json({ messages: visibleMessages, backfilled }, { headers: NO_STORE });
  } catch (error) {
    console.error("inbox_sync_failed", { reason: error instanceof Error ? error.message.slice(0, 180) : "unknown" });
    return Response.json({ error: "Your application messages could not be refreshed." }, { status: 502, headers: NO_STORE });
  }
}
