import { extractEmailAddress } from "@/lib/email/resend";
import { getTransactionalResend, transactionalEmailConfig } from "@/lib/email/transactional";
import { isVerifiedRecruiterRecipient, normaliseReplySubject, recruiterReplyIdempotencyKey } from "@/lib/email/recruiter-reply";
import { resolveEmployerDestinationForJob } from "@/lib/employer-destinations";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { consumeRateLimitKey, rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });

  try {
    const body = await readJsonBody<{ replyToMessageId?: unknown; message?: unknown }>(request, 50_000);
    const replyToMessageId = clean(body.replyToMessageId, 36);
    const message = clean(body.message, 40_000);
    const requestKey = request.headers.get("x-idempotency-key")?.trim() ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(replyToMessageId) || !/^[0-9a-f-]{36}$/i.test(requestKey) || !message) {
      return Response.json({ error: "Open an existing recruiter message and write your reply." }, { status: 400, headers: NO_STORE });
    }

    const config = transactionalEmailConfig();
    if (!config) return Response.json({ error: "Recruiter email sending is not available." }, { status: 503, headers: NO_STORE });

    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE });
    const rate = await consumeRateLimitKey("recruiter_email", data.user.id, 20, 60 * 60_000);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfter);

    const [{ data: inbox, error: inboxError }, { data: sourceMessage, error: messageError }] = await Promise.all([
      admin.from("inbox_aliases")
        .select("alias, provider_state")
        .eq("user_id", data.user.id)
        .maybeSingle(),
      admin.from("inbox_messages")
        .select("id, application_id, sender, subject")
        .eq("id", replyToMessageId)
        .eq("user_id", data.user.id)
        .maybeSingle(),
    ]);
    const alias = extractEmailAddress(String(inbox?.alias ?? ""));
    if (inboxError || !alias || inbox?.provider_state !== "connected") {
      return Response.json({ error: "Activate your private application address before sending recruiter email." }, { status: 409, headers: NO_STORE });
    }
    const recipient = extractEmailAddress(String(sourceMessage?.sender ?? ""));
    if (messageError || !sourceMessage || !sourceMessage.application_id || !recipient) {
      return Response.json({ error: "Replies are available only for recruiter messages linked to one of your applications." }, { status: 404, headers: NO_STORE });
    }
    const { data: packet, error: packetError } = await admin
      .from("application_packets")
      .select("job_snapshot")
      .eq("id", sourceMessage.application_id)
      .eq("user_id", data.user.id)
      .maybeSingle();
    const job = packet?.job_snapshot as { id?: string; company_name?: string } | null;
    if (packetError || !job?.id || !job.company_name) {
      return Response.json({ error: "The linked application could not be verified." }, { status: 404, headers: NO_STORE });
    }
    const destination = await resolveEmployerDestinationForJob({ id: job.id, company_name: job.company_name }, admin);
    if (!destination || !isVerifiedRecruiterRecipient(recipient, destination.email)) {
      return Response.json({ error: "Replies can be sent only to the verified recruitment address for this application." }, { status: 403, headers: NO_STORE });
    }
    const subject = normaliseReplySubject(String(sourceMessage.subject ?? ""));

    const firstName = clean(String(data.user.user_metadata?.full_name ?? data.user.user_metadata?.name ?? ""), 100).split(/\s+/)[0];
    const greeting = firstName ? `Sent by ${firstName} through IR35Careers` : "Sent through IR35Careers";
    const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f7f5;font-family:Arial,sans-serif;color:#07111f"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;border:1px solid #dbe5e1;border-radius:18px;background:#ffffff"><tr><td style="background:#07111f;padding:20px 26px;color:#ffffff;font-size:18px;font-weight:700">IR35<span style="color:#a9b8c8;font-weight:600">Careers</span></td></tr><tr><td style="padding:30px 26px"><p style="margin:0;white-space:pre-line;color:#334155;font-size:15px;line-height:24px">${escapeHtml(message)}</p></td></tr><tr><td style="border-top:1px solid #e2e8f0;background:#f8fafc;padding:16px 26px;color:#64748b;font-size:11px;line-height:18px">${escapeHtml(greeting)}. Replies return to the candidate's private application inbox.</td></tr></table></td></tr></table></body></html>`;
    const delivery = await getTransactionalResend(config).emails.send({
      from: `IR35Careers Applications <${alias}>`,
      to: [recipient],
      subject,
      html,
      text: message,
      replyTo: alias,
      headers: { "X-Entity-Ref-ID": requestKey },
      tags: [{ name: "email_type", value: "recruiter_compose" }],
    }, { idempotencyKey: recruiterReplyIdempotencyKey(data.user.id, replyToMessageId, requestKey) });
    if (delivery.error) throw new Error(delivery.error.message);
    return Response.json({ sent: true, providerMessageId: delivery.data?.id ?? null }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    return Response.json({ error: "The message could not be sent. Please try again later." }, { status: 502, headers: NO_STORE });
  }
}
