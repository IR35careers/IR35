import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { classifyFeedback, type FeedbackCategory, type FeedbackMessage, type FeedbackRecord } from "@/lib/admin-feedback";
import { sendFeedbackCreatedEmails, sendFeedbackEmail } from "@/lib/email/feedback-notifications";
import { requestUser } from "@/lib/request-user";
import { consumePublicRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const BUCKET = "feedback-attachments";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const VALID_TYPES = new Map([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"]]);
const VALID_CATEGORIES: FeedbackCategory[] = ["application", "job_listing", "account", "billing", "accessibility", "general"];

function clean(value: unknown, maximum: number): string {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, maximum);
}

function safePageUrl(value: unknown): string {
  const candidate = clean(value, 500);
  try {
    const parsed = new URL(candidate);
    const allowed = parsed.protocol === "https:" && ["www.ir35careers.com", "ir35careers.com"].includes(parsed.hostname)
      || parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
    return allowed ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function validImageBytes(bytes: Uint8Array, type: string): boolean {
  if (type === "image/png") return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === "image/jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/webp") return bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

async function signedUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const result = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return result.data?.signedUrl ?? null;
}

async function presentTicket(record: FeedbackRecord): Promise<FeedbackRecord> {
  const messages = await Promise.all((record.messages ?? []).map(async (message) => ({
    ...message,
    attachment_url: await signedUrl(message.attachment_path),
  })));
  return { ...record, attachment_url: await signedUrl(record.attachment_path), messages };
}

async function uploadAttachment(file: FormDataEntryValue | null, userId: string, ticketId: string): Promise<string | null> {
  if (!(file instanceof File) || !file.size) return null;
  const extension = VALID_TYPES.get(file.type);
  if (!extension) throw new Error("Upload a PNG, JPG or WebP image.");
  if (file.size > MAX_FILE_SIZE) throw new Error("The image must be 5 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validImageBytes(bytes, file.type)) throw new Error("The uploaded file is not a valid image.");
  const path = `${userId}/${ticketId}/${randomUUID()}.${extension}`;
  const upload = await getSupabaseAdmin().storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (upload.error) throw new Error("The screenshot could not be uploaded.");
  return path;
}

export async function GET(request: Request) {
  const auth = await requestUser(request);
  if ("response" in auth) return auth.response;
  const admin = getSupabaseAdmin();
  const result = await admin
    .from("contact_requests")
    .select("id, user_id, name, email, company, subject, message, status, category, page_url, browser_context, attachment_path, resolution_summary, acknowledged_at, resolved_at, created_at, updated_at, messages:feedback_messages(id, feedback_id, author_type, author_user_id, author_email, message, attachment_path, created_at, read_by_user_at)")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "feedback_messages", ascending: true });
  if (result.error) return NextResponse.json({ error: "Your feedback history could not be loaded." }, { status: 500, headers: NO_STORE });

  const tickets = await Promise.all((result.data ?? []).map((record) => presentTicket(record as FeedbackRecord)));
  return NextResponse.json({ tickets }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const rate = await consumePublicRateLimit(request, "feedback", 12, 60 * 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  const auth = await requestUser(request);
  if ("response" in auth) return auth.response;
  try {
    const form = await request.formData();
    const mode = clean(form.get("mode"), 20) || "create";
    const admin = getSupabaseAdmin();
    const email = auth.user.email?.trim().toLowerCase() ?? "";
    const metadataName = clean(auth.user.user_metadata?.full_name || auth.user.user_metadata?.name, 120);
    const profile = await admin.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();
    const name = clean(profile.data?.full_name, 120) || metadataName || email.split("@")[0] || "IR35Careers customer";

    if (mode === "read") {
      const feedbackId = clean(form.get("feedbackId"), 60);
      const ticket = await admin.from("contact_requests").select("id").eq("id", feedbackId).eq("user_id", auth.user.id).maybeSingle();
      if (ticket.error || !ticket.data) return NextResponse.json({ error: "That feedback ticket was not found." }, { status: 404, headers: NO_STORE });
      const read = await admin.from("feedback_messages").update({ read_by_user_at: new Date().toISOString() }).eq("feedback_id", feedbackId).eq("author_type", "admin").is("read_by_user_at", null);
      if (read.error) throw read.error;
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }

    if (mode === "reply") {
      const feedbackId = clean(form.get("feedbackId"), 60);
      const message = clean(form.get("message"), 5_000);
      if (!/^[0-9a-f-]{36}$/i.test(feedbackId)) return NextResponse.json({ error: "Choose a valid feedback ticket." }, { status: 400, headers: NO_STORE });
      if (message.length < 2) return NextResponse.json({ error: "Add a message before sending." }, { status: 400, headers: NO_STORE });
      const ticket = await admin.from("contact_requests").select("id, status, subject, name").eq("id", feedbackId).eq("user_id", auth.user.id).maybeSingle();
      if (ticket.error || !ticket.data) return NextResponse.json({ error: "That feedback ticket was not found." }, { status: 404, headers: NO_STORE });
      const attachmentPath = await uploadAttachment(form.get("attachment"), auth.user.id, feedbackId);
      const inserted = await admin.from("feedback_messages").insert({
        feedback_id: feedbackId,
        author_type: "customer",
        author_user_id: auth.user.id,
        author_email: email,
        message,
        attachment_path: attachmentPath,
      }).select("id, feedback_id, author_type, author_user_id, author_email, message, attachment_path, created_at, read_by_user_at").single();
      if (inserted.error) throw inserted.error;
      await admin.from("contact_requests").update({ status: ticket.data.status === "resolved" ? "in_progress" : ticket.data.status, updated_at: new Date().toISOString(), resolved_at: null }).eq("id", feedbackId);
      await sendFeedbackEmail({
        kind: "admin_alert",
        ticketId: feedbackId,
        recipient: "ir35careers@gmail.com",
        customerName: ticket.data.name,
        subject: `Customer reply: ${ticket.data.subject || "IR35Careers feedback"}`,
        message,
      }).catch(() => null);
      return NextResponse.json({ accepted: true, message: { ...inserted.data, attachment_url: await signedUrl(attachmentPath) } as FeedbackMessage }, { status: 201, headers: NO_STORE });
    }

    const subject = clean(form.get("subject"), 140);
    const message = clean(form.get("message"), 5_000);
    const suppliedCategory = clean(form.get("category"), 40) as FeedbackCategory;
    const category = VALID_CATEGORIES.includes(suppliedCategory) ? suppliedCategory : classifyFeedback(`${subject} ${message}`);
    const pageUrl = safePageUrl(form.get("pageUrl"));
    const browserContext = clean(form.get("browserContext"), 500);
    if (subject.length < 5) return NextResponse.json({ error: "Add a short title for the issue." }, { status: 400, headers: NO_STORE });
    if (message.length < 20) return NextResponse.json({ error: "Explain what happened and what you expected." }, { status: 400, headers: NO_STORE });

    const feedbackId = randomUUID();
    const attachmentPath = await uploadAttachment(form.get("attachment"), auth.user.id, feedbackId);
    const now = new Date().toISOString();
    const inserted = await admin.from("contact_requests").insert({
      id: feedbackId,
      user_id: auth.user.id,
      name,
      email,
      company: "",
      subject,
      message,
      status: "new",
      category,
      page_url: pageUrl,
      browser_context: browserContext,
      attachment_path: attachmentPath,
      acknowledged_at: now,
      updated_at: now,
    }).select("id, user_id, name, email, company, subject, message, status, category, page_url, browser_context, attachment_path, resolution_summary, acknowledged_at, resolved_at, created_at, updated_at").single();
    if (inserted.error) {
      if (attachmentPath) await admin.storage.from(BUCKET).remove([attachmentPath]);
      throw inserted.error;
    }
    await sendFeedbackCreatedEmails({
      ticketId: feedbackId,
      customerEmail: email,
      customerName: name,
      subject,
      message,
      pageUrl,
    });
    return NextResponse.json({ accepted: true, ticket: await presentTicket({ ...inserted.data, messages: [] } as FeedbackRecord), message: "Thank you for your feedback. We will review it and keep you updated." }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Your feedback could not be saved." }, { status: 500, headers: NO_STORE });
  }
}
