import { randomUUID } from "node:crypto";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import {
  applicationInboxAlias,
  ensureInboxAlias,
} from "@/lib/email/inbox-alias";
import {
  getTransactionalResend,
  transactionalEmailConfig,
} from "@/lib/email/transactional";
import type { getSupabaseAdmin } from "@/lib/supabase-admin";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdmin>;

export type InboundEmailLoopAuditCheck = {
  label: string;
  passed: boolean;
  detail: string;
};

export type InboundEmailLoopAuditResult = {
  ok: boolean;
  state: "submitted" | "failed";
  message: string;
  receiptId?: string;
  testedAt: string;
  checks: InboundEmailLoopAuditCheck[];
};

export async function runInboundEmailLoopAudit(input: {
  client: SupabaseAdminClient;
  userId: string;
  email: string;
}): Promise<InboundEmailLoopAuditResult> {
  const { client, userId, email } = input;
  const testedAt = new Date().toISOString();
  const emailConfig = transactionalEmailConfig();
  if (!emailConfig) throw new Error("Transactional email is not configured.");

  const inbox = await ensureInboxAlias(client, userId, email, true);
  if (!inbox)
    throw new Error("The inbound IR35Careers mailbox is not configured.");

  const applicationId = randomUUID();
  const marker = randomUUID().replaceAll("-", "").slice(0, 12);
  const subject = `Application received: Platform Engineer email loop test ${marker}`;
  const applicationAddress = applicationInboxAlias(inbox.alias, applicationId);
  const job = {
    ...DEMO_JOBS[0],
    id: applicationId,
    title: "Platform Engineer email loop test",
    company_name: "IR35Careers Test Portal",
    source_domain: "www.ir35careers.com",
    apply_url: "https://www.ir35careers.com/testing/application-form",
  };

  const packetInsert = await client.from("application_packets").insert({
    id: applicationId,
    user_id: userId,
    job_id: null,
    job_snapshot: job,
    status: "ready",
    mode: "external_handoff",
    match_score: 100,
    resume_version_label: "Controlled email loop test",
    source_cv_text: "Controlled test data",
    tailored_cv_text: "Controlled test data",
    cover_letter: "Controlled test data",
    screening_answers: [],
    matched_keywords: [],
    missing_keywords: [],
    truth_approved: true,
    materials_approved: true,
    submission_approved: true,
    receipt: {
      destination: "https://www.ir35careers.com/testing/application-form",
    },
    idempotency_key: `email-loop:${marker}`,
  });
  if (packetInsert.error) throw new Error(packetInsert.error.message);

  try {
    const delivery = await getTransactionalResend(emailConfig).emails.send(
      {
        from: emailConfig.from,
        to: [applicationAddress],
        subject,
        html: `<p>Thank you for applying. We have received your application for the Platform Engineer email loop test.</p><p>Reference: ${marker}</p>`,
        text: `Thank you for applying. We have received your application for the Platform Engineer email loop test. Reference: ${marker}`,
        ...(emailConfig.replyTo ? { replyTo: emailConfig.replyTo } : {}),
        headers: { "X-Entity-Ref-ID": `email-loop:${marker}` },
        tags: [{ name: "email_type", value: "inbound_loop_test" }],
      },
      { idempotencyKey: `ir35-inbound-loop-${marker}` },
    );
    if (delivery.error || !delivery.data?.id)
      throw new Error(
        delivery.error?.message || "The controlled inbound message was rejected.",
      );

    let receivedMessage: {
      id: string;
      provider_message_id: string | null;
      application_id: string | null;
    } | null = null;
    let forwardingSummary: Record<string, unknown> = {};
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline) {
      const received = await client
        .from("inbox_messages")
        .select("id, provider_message_id, application_id")
        .eq("user_id", userId)
        .eq("application_id", applicationId)
        .eq("subject", subject)
        .maybeSingle();
      if (received.error) throw new Error(received.error.message);
      receivedMessage = received.data;
      if (receivedMessage?.provider_message_id) {
        const forwarded = await client
          .from("moderation_logs")
          .select("summary")
          .eq("run_type", "inbound_email_delivery")
          .eq(
            "summary->>provider_message_id",
            receivedMessage.provider_message_id,
          )
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (forwarded.error) throw new Error(forwarded.error.message);
        if (
          forwarded.data?.summary &&
          typeof forwarded.data.summary === "object"
        ) {
          forwardingSummary = forwarded.data.summary as Record<
            string,
            unknown
          >;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }

    const forwardingAccepted =
      forwardingSummary.forwarding_status === "accepted" &&
      typeof forwardingSummary.forwarding_delivery_id === "string";
    const linked = receivedMessage?.application_id === applicationId;
    const packetStatus = await client
      .from("application_packets")
      .select("status")
      .eq("user_id", userId)
      .eq("id", applicationId)
      .maybeSingle();
    if (packetStatus.error) throw new Error(packetStatus.error.message);
    const statusApplied = packetStatus.data?.status === "applied";
    const checks: InboundEmailLoopAuditCheck[] = [
      {
        label: "Inbound message accepted",
        passed: Boolean(delivery.data?.id),
        detail:
          "Resend accepted the controlled message for the private application address.",
      },
      {
        label: "Signed webhook received",
        passed: Boolean(receivedMessage?.provider_message_id),
        detail: receivedMessage
          ? "The signed inbound webhook stored the original message."
          : "No signed inbound webhook arrived within 75 seconds.",
      },
      {
        label: "Application linked",
        passed: linked,
        detail: linked
          ? "The application-specific address linked the message to the correct packet."
          : "The message was not linked to the controlled application.",
      },
      {
        label: "Forwarding accepted",
        passed: forwardingAccepted,
        detail: forwardingAccepted
          ? `The forwarded notification was accepted for ${email}.`
          : String(
              forwardingSummary.forwarding_error ||
                "The forwarding provider did not return an accepted delivery.",
            ),
      },
      {
        label: "Application status updated",
        passed: statusApplied,
        detail: statusApplied
          ? "The trusted employer confirmation moved the application to Applied."
          : `The application remained ${String(packetStatus.data?.status || "unknown")}.`,
      },
    ];
    const passed = checks.every((check) => check.passed);

    await client.from("moderation_logs").insert({
      run_type: "inbound_email_loop_test",
      summary: {
        action: "controlled_inbound_email_loop",
        by: email,
        state: passed ? "submitted" : "failed",
        tested_at: testedAt,
        outbound_delivery_id: delivery.data.id,
        inbound_message_id: receivedMessage?.provider_message_id ?? null,
        forwarding_delivery_id:
          forwardingSummary.forwarding_delivery_id ?? null,
        checks,
      },
    });

    return {
      ok: passed,
      state: passed ? "submitted" : "failed",
      message: passed
        ? `The private application email was received, linked and forwarded to ${email}.`
        : "The controlled email loop did not complete. Review the failed check.",
      receiptId:
        typeof forwardingSummary.forwarding_delivery_id === "string"
          ? forwardingSummary.forwarding_delivery_id
          : delivery.data.id,
      testedAt,
      checks,
    };
  } finally {
    await client
      .from("inbox_messages")
      .delete()
      .eq("user_id", userId)
      .eq("application_id", applicationId);
    await client
      .from("application_events")
      .delete()
      .eq("user_id", userId)
      .eq("application_id", applicationId);
    await client
      .from("application_packets")
      .delete()
      .eq("user_id", userId)
      .eq("id", applicationId);
  }
}
