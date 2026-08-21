import { NextResponse } from "next/server";
import {
  getResend,
  extractEmailAddress,
  isReceivedEmailEvent,
  normaliseResendEmail,
  resendInboundConfig,
  verifyResendWebhook,
} from "@/lib/email/resend";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendApplicationNotification, type ApplicationNotificationKind } from "@/lib/email/application-notifications";
import { classifyInboundMessage, findLinkedApplication } from "@/lib/workspace/mail";
import type { ApplicationRecord, ApplicationStatus, InboxClassification } from "@/lib/workspace/types";

export const runtime = "nodejs";

const RESPONSE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function messageTransition(classification: InboxClassification, current: ApplicationStatus): { status: ApplicationStatus; label: string; notification: ApplicationNotificationKind } {
  if (classification === "interview") return { status: "interview", label: "Interview message received", notification: "interview" };
  if (classification === "rejection") return { status: "rejected", label: "Employer closed the application", notification: "rejection" };
  if (classification === "action_required") return { status: "needs_review", label: "Recruiter needs more information", notification: "needs_attention" };
  if (classification === "application_update") return { status: current === "applied" ? "viewed" : current, label: "Application update received", notification: "update" };
  return { status: ["interview", "offer", "rejected", "withdrawn"].includes(current) ? current : "replied", label: "Recruiter message received", notification: "reply" };
}

export async function POST(request: Request) {
  if (process.env.ENABLE_INBOUND_MAIL !== "true") {
    return NextResponse.json({ error: "Inbound mail is disabled." }, { status: 503, headers: RESPONSE_HEADERS });
  }
  const config = resendInboundConfig();
  if (!config) {
    return NextResponse.json({ error: "Resend inbound mail is not configured." }, { status: 503, headers: RESPONSE_HEADERS });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 300_000) {
    return NextResponse.json({ error: "Payload is too large." }, { status: 413, headers: RESPONSE_HEADERS });
  }

  const rawBody = await request.text();
  const webhookHeaders = {
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
  };
  if (!webhookHeaders.id || !webhookHeaders.timestamp || !webhookHeaders.signature) {
    return NextResponse.json({ error: "Webhook signature headers are missing." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const resend = getResend(config);
  let event;
  try {
    event = verifyResendWebhook(resend, rawBody, webhookHeaders, config.webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401, headers: RESPONSE_HEADERS });
  }
  if (!isReceivedEmailEvent(event)) {
    return NextResponse.json({ accepted: true, ignored: true }, { status: 200, headers: RESPONSE_HEADERS });
  }
  if (!/^[0-9a-f-]{36}$/i.test(event.data.email_id)) {
    return NextResponse.json({ error: "Received email identifier is invalid." }, { status: 400, headers: RESPONSE_HEADERS });
  }

  try {
    const eventRecipients = Array.from(new Set([
      ...event.data.to,
      ...event.data.received_for,
    ].map(extractEmailAddress).filter((value) => value.endsWith(`@${config.domain}`)))).slice(0, 50);
    if (eventRecipients.length === 0) {
      return NextResponse.json({ accepted: true, ignored: true, reason: "recipient_domain" }, { status: 200, headers: RESPONSE_HEADERS });
    }

    const admin = getSupabaseAdmin();
    const { data: aliasRows, error: aliasError } = await admin
      .from("inbox_aliases")
      .select("user_id, alias, forwarding_email, forwarding_enabled")
      .in("alias", eventRecipients)
      .limit(1);
    if (aliasError) throw new Error(aliasError.message);
    const alias = aliasRows?.[0];
    if (!alias) {
      return NextResponse.json({ accepted: true, ignored: true, reason: "unknown_alias" }, { status: 200, headers: RESPONSE_HEADERS });
    }

    const { data: email, error: emailError } = await resend.emails.receiving.get(event.data.email_id, { html_format: "cid" });
    if (emailError || !email) throw new Error(emailError?.message ?? "Received email content is unavailable.");
    const payload = normaliseResendEmail(event, email, config.domain);
    if (!payload.providerMessageId || !payload.sender || !payload.recipients.includes(alias.alias)) {
      return NextResponse.json({ error: "Required received-email fields are missing." }, { status: 400, headers: RESPONSE_HEADERS });
    }

    const { data: existingMessage, error: duplicateError } = await admin.from("inbox_messages")
      .select("id")
      .eq("user_id", alias.user_id)
      .eq("provider_message_id", payload.providerMessageId)
      .maybeSingle();
    if (duplicateError) throw new Error(duplicateError.message);
    if (existingMessage) return NextResponse.json({ accepted: true, duplicate: true }, { status: 200, headers: RESPONSE_HEADERS });

    const { data: packetRows, error: packetError } = await admin
      .from("application_packets")
      .select("id, job_snapshot, status")
      .eq("user_id", alias.user_id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (packetError) throw new Error(packetError.message);
    const candidates = (packetRows ?? []).map((row) => ({ id: row.id, job: row.job_snapshot })) as Array<Pick<ApplicationRecord, "id" | "job">>;
    const applicationId = findLinkedApplication(payload.subject, payload.text, candidates);
    const classification = classifyInboundMessage(payload.subject, payload.text);

    const { error: messageError } = await admin.from("inbox_messages").upsert({
      user_id: alias.user_id,
      application_id: applicationId,
      provider_message_id: payload.providerMessageId,
      sender: payload.sender,
      recipient: alias.alias,
      subject: payload.subject,
      body_text: payload.text,
      preview: payload.text.replace(/\s+/g, " ").slice(0, 220),
      classification,
      received_at: payload.receivedAt,
    }, { onConflict: "user_id,provider_message_id", ignoreDuplicates: true });
    if (messageError) throw new Error(messageError.message);

    if (applicationId) {
      const linkedPacket = (packetRows ?? []).find((row) => String(row.id) === applicationId);
      const currentStatus = (linkedPacket?.status ?? "applied") as ApplicationStatus;
      const transition = messageTransition(classification, currentStatus);
      await admin.from("application_packets").update({ status: transition.status, updated_at: new Date().toISOString() }).eq("id", applicationId).eq("user_id", alias.user_id);
      await admin.from("application_events").upsert({
        user_id: alias.user_id,
        application_id: applicationId,
        event_type: "message_received",
        label: transition.label,
        metadata: { classification, providerMessageId: payload.providerMessageId, webhookId: webhookHeaders.id },
        idempotency_key: `mail:${payload.providerMessageId}`,
      }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true });

      const job = linkedPacket?.job_snapshot as ApplicationRecord["job"] | undefined;
      if (job && alias.forwarding_enabled && alias.forwarding_email) {
        await sendApplicationNotification({
          kind: transition.notification,
          to: String(alias.forwarding_email),
          jobTitle: job.title,
          companyName: job.company_name,
          applicationId,
          originalSubject: payload.subject,
          originalMessage: payload.text,
          replyTo: payload.sender,
          idempotencyKey: `mail:${payload.providerMessageId}`,
        }).catch(() => null);
      }
    }

    return NextResponse.json({ accepted: true, classification, linked: Boolean(applicationId) }, { status: 200, headers: RESPONSE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Inbound message could not be processed." }, { status: 500, headers: RESPONSE_HEADERS });
  }
}
