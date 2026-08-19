import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { classifyInboundMessage, findLinkedApplication } from "@/lib/workspace/mail";
import type { ApplicationRecord } from "@/lib/workspace/types";

export const runtime = "nodejs";

interface NormalisedInboundPayload {
  providerMessageId: string;
  recipient: string;
  sender: string;
  subject: string;
  text: string;
  receivedAt?: string;
}

function validSignature(rawBody: string, provided: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

function clean(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

export async function POST(request: Request) {
  if (process.env.ENABLE_INBOUND_MAIL !== "true") return NextResponse.json({ error: "Inbound mail is disabled." }, { status: 503 });
  const secret = process.env.INBOUND_MAIL_SIGNING_SECRET;
  if (!secret) return NextResponse.json({ error: "Inbound mail signing is not configured." }, { status: 503 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 300_000) return NextResponse.json({ error: "Payload is too large." }, { status: 413 });

  const rawBody = await request.text();
  if (!validSignature(rawBody, request.headers.get("x-ir35-signature") ?? "", secret)) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });

  try {
    const raw = JSON.parse(rawBody) as Partial<NormalisedInboundPayload>;
    const payload: NormalisedInboundPayload = {
      providerMessageId: clean(raw.providerMessageId, 300),
      recipient: clean(raw.recipient, 254).toLowerCase(),
      sender: clean(raw.sender, 254),
      subject: clean(raw.subject, 500),
      text: clean(raw.text, 100_000),
      receivedAt: clean(raw.receivedAt, 80),
    };
    if (!payload.providerMessageId || !payload.recipient || !payload.sender) return NextResponse.json({ error: "Required message fields are missing." }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: alias, error: aliasError } = await admin.from("inbox_aliases").select("user_id, alias").eq("alias", payload.recipient).maybeSingle();
    if (aliasError) throw new Error(aliasError.message);
    if (!alias) return NextResponse.json({ error: "Unknown inbox alias." }, { status: 404 });

    const { data: packetRows, error: packetError } = await admin.from("application_packets").select("id, job_snapshot").eq("user_id", alias.user_id).order("updated_at", { ascending: false }).limit(100);
    if (packetError) throw new Error(packetError.message);
    const candidates = (packetRows ?? []).map((row) => ({ id: row.id, job: row.job_snapshot })) as Array<Pick<ApplicationRecord, "id" | "job">>;
    const applicationId = findLinkedApplication(payload.subject, payload.text, candidates);
    const classification = classifyInboundMessage(payload.subject, payload.text);
    const receivedAt = payload.receivedAt && Number.isFinite(new Date(payload.receivedAt).getTime()) ? new Date(payload.receivedAt).toISOString() : new Date().toISOString();

    const { error: messageError } = await admin.from("inbox_messages").upsert({
      user_id: alias.user_id,
      application_id: applicationId,
      provider_message_id: payload.providerMessageId,
      sender: payload.sender,
      recipient: payload.recipient,
      subject: payload.subject,
      body_text: payload.text,
      preview: payload.text.replace(/\s+/g, " ").slice(0, 220),
      classification,
      received_at: receivedAt,
    }, { onConflict: "user_id,provider_message_id", ignoreDuplicates: true });
    if (messageError) throw new Error(messageError.message);

    if (applicationId) {
      const nextStatus = classification === "interview" ? "interview" : "replied";
      await admin.from("application_packets").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", applicationId).eq("user_id", alias.user_id);
      await admin.from("application_events").upsert({
        user_id: alias.user_id,
        application_id: applicationId,
        event_type: "message_received",
        label: classification === "interview" ? "Interview message received" : "Recruiter message received",
        metadata: { classification, providerMessageId: payload.providerMessageId },
        idempotency_key: `mail:${payload.providerMessageId}`,
      }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true });
    }

    return NextResponse.json({ accepted: true, classification, linked: Boolean(applicationId) }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Inbound message could not be processed." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}

