import { readFile } from "node:fs/promises";
import path from "node:path";
import type { User } from "@supabase/supabase-js";
import { renderWelcomeEmail } from "@/lib/email/templates";
import { ensureInboxAlias } from "@/lib/email/inbox-alias";
import {
  getTransactionalResend,
  transactionalEmailConfig,
} from "@/lib/email/transactional";
import { requestUser } from "@/lib/request-user";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const EVENT_TYPE = "welcome";

function eligibleForWelcome(user: User): boolean {
  if (!user.email || !(user.email_confirmed_at || user.confirmed_at))
    return false;
  const marker = String(user.user_metadata?.welcome_email_eligible_at ?? "");
  if (Number.isFinite(new Date(marker).getTime())) return true;
  const createdAt = new Date(user.created_at).getTime();
  return Number.isFinite(createdAt) && Date.now() - createdAt <= 30 * 60 * 1000;
}
function firstName(user: User): string {
  return String(
    user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.user_metadata?.given_name ||
      "",
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requestUser(request);
    if ("response" in auth) return auth.response;
    if (!eligibleForWelcome(auth.user))
      return new Response(null, { status: 204, headers: NO_STORE });

    const admin = getSupabaseAdmin();
    // Create the member's private application address as soon as their account
    // is confirmed. A temporary email-provider outage must not prevent the
    // member from receiving recruiter messages later.
    await ensureInboxAlias(admin, auth.user.id, auth.user.email!, true);

    const config = transactionalEmailConfig();
    if (!config) return new Response(null, { status: 204, headers: NO_STORE });
    const { data: existing, error: lookupError } = await admin
      .from("email_delivery_events")
      .select("status, attempts")
      .eq("user_id", auth.user.id)
      .eq("event_type", EVENT_TYPE)
      .maybeSingle();
    if (lookupError) throw new Error("delivery-ledger-unavailable");
    if (existing?.status === "sent" || existing?.status === "processing") {
      return Response.json(
        { delivered: existing.status === "sent" },
        { headers: NO_STORE },
      );
    }

    if (existing?.status === "failed") {
      if ((existing.attempts ?? 0) >= 3)
        return new Response(null, { status: 204, headers: NO_STORE });
      const { data: claimed, error: claimError } = await admin
        .from("email_delivery_events")
        .update({
          status: "processing",
          attempts: (existing.attempts ?? 1) + 1,
          error_code: "",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", auth.user.id)
        .eq("event_type", EVENT_TYPE)
        .eq("status", "failed")
        .select("id")
        .maybeSingle();
      if (claimError) throw new Error("delivery-claim-failed");
      if (!claimed)
        return Response.json(
          { delivered: false },
          { status: 202, headers: NO_STORE },
        );
    } else {
      const { error: insertError } = await admin
        .from("email_delivery_events")
        .insert({
          user_id: auth.user.id,
          event_type: EVENT_TYPE,
          status: "processing",
        });
      if (insertError?.code === "23505")
        return Response.json(
          { delivered: false },
          { status: 202, headers: NO_STORE },
        );
      if (insertError) throw new Error("delivery-claim-failed");
    }

    const siteUrl = (
      process.env.NEXT_PUBLIC_SITE_URL || "https://www.ir35careers.com"
    ).replace(/\/$/, "");
    const content = renderWelcomeEmail({
      firstName: firstName(auth.user),
      siteUrl,
      logoSource: "cid:ir35careers-mark",
    });
    let logo: Buffer | null = null;
    try {
      logo = await readFile(
        path.join(
          process.cwd(),
          "public",
          "images",
          "generated",
          "brand",
          "ir35careers-mark-256.png",
        ),
      );
    } catch {
      content.html = renderWelcomeEmail({
        firstName: firstName(auth.user),
        siteUrl,
      }).html;
    }

    const { data, error } = await getTransactionalResend(config).emails.send(
      {
        from: config.from,
        to: [auth.user.email!],
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
        ...(logo
          ? {
              attachments: [
                {
                  filename: "ir35careers-mark.png",
                  content: logo,
                  contentId: "ir35careers-mark",
                },
              ],
            }
          : {}),
        tags: [{ name: "email_type", value: EVENT_TYPE }],
      },
      { idempotencyKey: `welcome-user/${auth.user.id}` },
    );

    if (error || !data?.id) {
      await admin
        .from("email_delivery_events")
        .update({
          status: "failed",
          error_code: error?.name || "provider_error",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", auth.user.id)
        .eq("event_type", EVENT_TYPE);
      return Response.json(
        { error: "Welcome email delivery is temporarily unavailable." },
        { status: 503, headers: NO_STORE },
      );
    }

    const now = new Date().toISOString();
    const { error: saveError } = await admin
      .from("email_delivery_events")
      .update({
        status: "sent",
        provider_message_id: data.id,
        sent_at: now,
        updated_at: now,
      })
      .eq("user_id", auth.user.id)
      .eq("event_type", EVENT_TYPE);
    if (saveError) throw new Error("delivery-ledger-save-failed");

    return Response.json(
      { delivered: true },
      { status: 201, headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { error: "Welcome email delivery is temporarily unavailable." },
      { status: 503, headers: NO_STORE },
    );
  }
}
