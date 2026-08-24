import { after, NextResponse } from "next/server";
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
import { applicationMessageTransition } from "@/lib/email/application-message-transition";
import { resolveEmployerDestinationForJob } from "@/lib/employer-destinations";
import { isVerifiedRecruiterRecipient } from "@/lib/email/recruiter-reply";
import {
  classifyInboundMessage,
  findLinkedApplication,
  isUnsolicitedJobMarketingMessage,
} from "@/lib/workspace/mail";
import type { ApplicationRecord } from "@/lib/workspace/types";
import { readTextBody, RequestBodyError } from "@/lib/security/request-body";
import { consumeRateLimitKey } from "@/lib/security/rate-limit";
import { isTrustedApplicationPortalSender } from "@/lib/application-runner/ats";
import {
  clearPortalSession,
  loadPortalSession,
} from "@/lib/application-portal-session";
import { createHash } from "node:crypto";
import { extractEmailVerificationCode } from "@/lib/email/verification-code";
import { extractEmailActionLink } from "@/lib/email/action-link";
import { createApplicationResumeAuthorization } from "@/lib/application-internal-resume";
import { parseApplicationInboxAlias } from "@/lib/email/inbox-alias";

export const runtime = "nodejs";
export const maxDuration = 300;

const RESPONSE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  if (process.env.ENABLE_INBOUND_MAIL !== "true") {
    return NextResponse.json({ error: "Inbound mail is disabled." }, { status: 503, headers: RESPONSE_HEADERS });
  }
  const config = resendInboundConfig();
  if (!config) {
    return NextResponse.json({ error: "Resend inbound mail is not configured." }, { status: 503, headers: RESPONSE_HEADERS });
  }
  let rawBody: string;
  try {
    rawBody = await readTextBody(request, 300_000);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid webhook payload." },
      { status: error instanceof RequestBodyError ? error.status : 400, headers: RESPONSE_HEADERS },
    );
  }
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

    const routedRecipients = eventRecipients.map((recipient) => ({
      recipient,
      ...parseApplicationInboxAlias(recipient),
    }));
    const baseRecipients = Array.from(
      new Set(routedRecipients.map((recipient) => recipient.baseAlias)),
    );

    const admin = getSupabaseAdmin();
    const { data: aliasRows, error: aliasError } = await admin
      .from("inbox_aliases")
      .select("user_id, alias, forwarding_email, forwarding_enabled")
      .in("alias", baseRecipients);
    if (aliasError) throw new Error(aliasError.message);
    const alias = aliasRows?.find((row) =>
      routedRecipients.some(
        (recipient) => recipient.baseAlias === String(row.alias).toLowerCase(),
      ),
    );
    if (!alias) {
      return NextResponse.json({ accepted: true, ignored: true, reason: "unknown_alias" }, { status: 200, headers: RESPONSE_HEADERS });
    }
    const routedRecipient = routedRecipients.find(
      (recipient) =>
        recipient.baseAlias === String(alias.alias).toLowerCase(),
    );
    const inboundRate = await consumeRateLimitKey("inbound_mail", String(alias.user_id), 200, 24 * 60 * 60_000);
    if (!inboundRate.allowed) {
      return NextResponse.json({ accepted: true, ignored: true, reason: "rate_limit" }, { status: 200, headers: RESPONSE_HEADERS });
    }

    const { data: email, error: emailError } = await resend.emails.receiving.get(event.data.email_id, { html_format: "cid" });
    if (emailError || !email) throw new Error(emailError?.message ?? "Received email content is unavailable.");
    const payload = normaliseResendEmail(event, email, config.domain);
    const receivedForAlias = payload.recipients.find(
      (recipient) =>
        parseApplicationInboxAlias(recipient).baseAlias ===
        String(alias.alias).toLowerCase(),
    );
    if (!payload.providerMessageId || !payload.sender || !receivedForAlias) {
      return NextResponse.json({ error: "Required received-email fields are missing." }, { status: 400, headers: RESPONSE_HEADERS });
    }
    if (
      isUnsolicitedJobMarketingMessage(
        payload.subject,
        payload.text,
        payload.sender,
      )
    ) {
      return NextResponse.json(
        { accepted: true, ignored: true, reason: "job_marketing" },
        { status: 200, headers: RESPONSE_HEADERS },
      );
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
      .select("id, job_snapshot, status, receipt")
      .eq("user_id", alias.user_id)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (packetError) throw new Error(packetError.message);
    const candidates = (packetRows ?? []).map((row) => ({ id: row.id, job: row.job_snapshot })) as Array<Pick<ApplicationRecord, "id" | "job">>;
    const verificationCode = extractEmailVerificationCode(
      payload.subject,
      payload.text,
    );
    const emailActionLink = extractEmailActionLink(
      payload.subject,
      payload.text,
    );
    const hintedApplicationId = routedRecipient?.applicationId;
    const validHint = hintedApplicationId
      ? (packetRows ?? []).some(
          (row) => String(row.id) === hintedApplicationId,
        )
      : false;
    let applicationId = validHint
      ? String(hintedApplicationId)
      : findLinkedApplication(
      payload.subject,
      payload.text,
      candidates,
    );
    let verificationApplicationMatched = Boolean(
      validHint && (verificationCode || emailActionLink),
    );
    if (!applicationId && (verificationCode || emailActionLink)) {
      const { data: pendingRows, error: pendingRowsError } = await admin
        .from("application_submissions")
        .select("application_id, receipt")
        .eq("user_id", alias.user_id)
        .eq("status", "processing")
        .eq("error_code", "needs_user")
        .order("updated_at", { ascending: false })
        .limit(5);
      if (pendingRowsError) throw new Error(pendingRowsError.message);
      const verificationApplications = (pendingRows ?? []).filter((row) => {
        const receipt = row.receipt as {
          action?: unknown;
          attention?: { action?: unknown };
        } | null;
        return [
          "verification_code",
          "verification_link",
          "account_recovery_email",
        ].includes(
          String(receipt?.action ?? receipt?.attention?.action ?? ""),
        );
      });
      if (verificationApplications.length === 1) {
        applicationId = String(verificationApplications[0].application_id);
        verificationApplicationMatched = true;
      }
    }
    const linkedPacket = applicationId ? (packetRows ?? []).find((row) => String(row.id) === applicationId) : undefined;
    const linkedJob = linkedPacket?.job_snapshot as ApplicationRecord["job"] | undefined;
    const verifiedDestination = linkedJob
      ? await resolveEmployerDestinationForJob(linkedJob, admin)
      : null;
    let receiptDestination = String(
      (linkedPacket?.receipt as { destination?: unknown } | null)?.destination ?? "",
    );
    if (!receiptDestination && applicationId) {
      const portalSession = await loadPortalSession({
        admin,
        userId: String(alias.user_id),
        applicationId,
      }).catch(() => null);
      receiptDestination = portalSession?.currentUrl ?? "";
    }
    const trustedSender = Boolean(
      (verifiedDestination &&
        isVerifiedRecruiterRecipient(payload.sender, verifiedDestination.email)) ||
        (receiptDestination &&
          isTrustedApplicationPortalSender(payload.sender, receiptDestination)),
    );
    const classification = trustedSender ? classifyInboundMessage(payload.subject, payload.text) : "other";

    const { error: messageError } = await admin.from("inbox_messages").upsert({
      user_id: alias.user_id,
      application_id: applicationId,
      provider_message_id: payload.providerMessageId,
      sender: payload.sender,
      recipient: receivedForAlias,
      subject: payload.subject,
      body_text: payload.text,
      preview: payload.text.replace(/\s+/g, " ").slice(0, 220),
      classification,
      received_at: payload.receivedAt,
    }, { onConflict: "user_id,provider_message_id", ignoreDuplicates: true });
    if (messageError) throw new Error(messageError.message);

    let resumeQueued = false;
    if (
      applicationId &&
      (verificationCode || emailActionLink) &&
      (trustedSender || verificationApplicationMatched)
    ) {
      const { data: pendingSubmission, error: pendingError } = await admin
        .from("application_submissions")
        .select("status, error_code, receipt")
        .eq("user_id", alias.user_id)
        .eq("application_id", applicationId)
        .maybeSingle();
      if (pendingError) throw new Error(pendingError.message);
      const pendingReceipt = pendingSubmission?.receipt as {
        action?: unknown;
        attention?: { action?: unknown };
      } | null;
      const pendingAction = String(
        pendingReceipt?.action ?? pendingReceipt?.attention?.action ?? "",
      );
      if (
        pendingSubmission?.status === "processing" &&
        pendingSubmission.error_code === "needs_user" &&
        [
          "verification_code",
          "verification_link",
          "account_recovery_email",
        ].includes(pendingAction)
      ) {
        const resumeAuthorization = createApplicationResumeAuthorization({
          applicationId,
          userId: String(alias.user_id),
        });
        if (resumeAuthorization) {
          const resumeUrl = new URL(
            "/api/applications/submit",
            request.url,
          ).toString();
          resumeQueued = true;
          after(async () => {
            const response = await fetch(resumeUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-ir35-resume-timestamp": resumeAuthorization.timestamp,
                "x-ir35-resume-signature": resumeAuthorization.signature,
              },
              body: JSON.stringify({
                applicationId,
                internalUserId: String(alias.user_id),
                approval: "SUBMIT_APPROVED_APPLICATION",
              }),
              signal: AbortSignal.timeout(20_000),
            }).catch(() => null);
            if (!response?.ok)
              console.warn("application_verification_resume_failed", {
                applicationId,
                status: response?.status ?? 0,
              });
          });
        }
      }
    }

    let forwardingKind: ApplicationNotificationKind = "message";
    if (applicationId && trustedSender) {
      const currentStatus = (linkedPacket?.status ??
        "applied") as ApplicationRecord["status"];
      const transition = applicationMessageTransition(
        classification,
        currentStatus,
      );
      forwardingKind = transition.notification;
      const now = new Date().toISOString();
      const existingReceipt = linkedPacket?.receipt as ApplicationRecord["receipt"];
      const emailReceipt =
        transition.status === "applied" && !existingReceipt
          ? {
              receiptId: `mail-${createHash("sha256")
                .update(payload.providerMessageId)
                .digest("hex")
                .slice(0, 18)}`,
              mode: "external_handoff" as const,
              createdAt: payload.receivedAt,
              destination: receiptDestination,
              reviewedFields: ["employer_email_confirmation"],
              skippedFields: [],
              message:
                "The employer confirmed receipt of this application by email.",
            }
          : existingReceipt;
      await admin
        .from("application_packets")
        .update({
          status: transition.status,
          ...(emailReceipt ? { receipt: emailReceipt } : {}),
          updated_at: now,
        })
        .eq("id", applicationId)
        .eq("user_id", alias.user_id);
      if (transition.status === "applied")
        await clearPortalSession({
          admin,
          userId: String(alias.user_id),
          applicationId,
        }).catch(() => null);
      await admin.from("application_events").upsert({
        user_id: alias.user_id,
        application_id: applicationId,
        event_type: "message_received",
        label: transition.label,
        metadata: { classification, providerMessageId: payload.providerMessageId, webhookId: webhookHeaders.id },
        idempotency_key: `mail:${payload.providerMessageId}`,
      }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true });

    } else if (applicationId) {
      await admin.from("application_events").upsert({
        user_id: alias.user_id,
        application_id: applicationId,
        event_type: "message_received",
        label: "Application email received",
        metadata: {
          classification: "other",
          providerMessageId: payload.providerMessageId,
          webhookId: webhookHeaders.id,
          senderVerified: false,
        },
        idempotency_key: `mail:${payload.providerMessageId}`,
      }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true });
    }

    let forwardingDeliveryId: string | null = null;
    let forwardingError: string | null = null;
    if (
      applicationId &&
      linkedJob &&
      alias.forwarding_enabled &&
      alias.forwarding_email
    ) {
      try {
        forwardingDeliveryId = await sendApplicationNotification({
          kind: forwardingKind,
          to: String(alias.forwarding_email),
          jobTitle: linkedJob.title,
          companyName: linkedJob.company_name,
          jobId: linkedJob.id,
          applicationId,
          originalSubject: payload.subject,
          originalMessage: payload.text,
          ...(trustedSender ? { replyTo: payload.sender } : {}),
          idempotencyKey: `mail:${payload.providerMessageId}`,
        });
      } catch (error) {
        forwardingError =
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Forwarding delivery failed.";
      }

      await admin.from("moderation_logs").insert({
        run_type: "inbound_email_delivery",
        summary: {
          user_id: alias.user_id,
          application_id: applicationId,
          provider_message_id: payload.providerMessageId,
          recipient: String(alias.forwarding_email),
          linked: true,
          trusted_sender: trustedSender,
          classification,
          forwarding_status: forwardingDeliveryId
            ? "accepted"
            : forwardingError
              ? "failed"
              : "not_configured",
          forwarding_delivery_id: forwardingDeliveryId,
          forwarding_error: forwardingError,
        },
      });
    }

    return NextResponse.json(
      {
        accepted: true,
        classification,
        linked: Boolean(applicationId),
        trustedSender,
        resumeQueued,
        forwardingAccepted: Boolean(forwardingDeliveryId),
      },
      { status: 200, headers: RESPONSE_HEADERS },
    );
  } catch {
    return NextResponse.json({ error: "Inbound message could not be processed." }, { status: 500, headers: RESPONSE_HEADERS });
  }
}
