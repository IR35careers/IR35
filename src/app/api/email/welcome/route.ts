import { readFile } from "node:fs/promises";
import path from "node:path";
import type { User } from "@supabase/supabase-js";
import { renderWelcomeEmail } from "@/lib/email/templates";
import { getTransactionalResend, transactionalEmailConfig } from "@/lib/email/transactional";
import { requestUser } from "@/lib/request-user";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const EVENT_TYPE = "welcome";

function eligibleForWelcome(user: User): boolean {
  if (!user.email || !(user.email_confirmed_at || user.confirmed_at)) return false;
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
    ""
  );
}

export async function POST(request: Request): Promise<Response> {
  const config = transactionalEmailConfig();
  if (!config) return new Response(null, { status: 204, headers: NO_STORE });

  try {
    const auth = await requestUser(request);
    if ("response" in auth) return auth.response;
    if (!eligibleForWelcome(auth.user)) return new Response(null, { status: 204, headers: NO_STORE });

    const admin = getSupabaseAdmin();
    const metadata = auth.user.app_metadata ?? {};
    if (metadata.welcome_email_sent_at) return Response.json({ delivered: true }, { headers: NO_STORE });
    const attempts = Number(metadata.welcome_email_attempts ?? 0);
    if (attempts >= 3) return new Response(null, { status: 204, headers: NO_STORE });
    const processingAt = new Date(String(metadata.welcome_email_processing_at ?? "")).getTime();
    if (metadata.welcome_email_status === "processing" && Number.isFinite(processingAt) && Date.now() - processingAt < 10 * 60 * 1000) {
      return Response.json({ delivered: false }, { status: 202, headers: NO_STORE });
    }

    const processingAtIso = new Date().toISOString();
    const { error: claimError } = await admin.auth.admin.updateUserById(auth.user.id, {
      app_metadata: {
        ...metadata,
        welcome_email_status: "processing",
        welcome_email_processing_at: processingAtIso,
        welcome_email_attempts: attempts + 1,
      },
    });
    if (claimError) throw new Error("delivery-claim-failed");

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.ir35careers.com").replace(/\/$/, "");
    const content = renderWelcomeEmail({ firstName: firstName(auth.user), siteUrl, logoSource: "cid:ir35careers-mark" });
    let logo: Buffer | null = null;
    try {
      logo = await readFile(path.join(process.cwd(), "public", "images", "generated", "brand", "ir35careers-mark-256.png"));
    } catch {
      content.html = renderWelcomeEmail({ firstName: firstName(auth.user), siteUrl }).html;
    }

    const { data, error } = await getTransactionalResend(config).emails.send(
      {
        from: config.from,
        to: [auth.user.email!],
        subject: content.subject,
        html: content.html,
        text: content.text,
        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
        ...(logo ? { attachments: [{ filename: "ir35careers-mark.png", content: logo, contentId: "ir35careers-mark" }] } : {}),
        tags: [{ name: "email_type", value: EVENT_TYPE }],
      },
      { idempotencyKey: `welcome-user/${auth.user.id}` }
    );

    if (error || !data?.id) {
      await admin.auth.admin.updateUserById(auth.user.id, {
        app_metadata: {
          ...metadata,
          welcome_email_status: "failed",
          welcome_email_attempts: attempts + 1,
        },
      });
      return Response.json({ error: "Welcome email delivery is temporarily unavailable." }, { status: 503, headers: NO_STORE });
    }

    const now = new Date().toISOString();
    const { error: saveError } = await admin.auth.admin.updateUserById(auth.user.id, {
      app_metadata: {
        ...metadata,
        welcome_email_status: "sent",
        welcome_email_sent_at: now,
        welcome_email_attempts: attempts + 1,
      },
    });
    if (saveError) throw new Error("delivery-ledger-save-failed");

    return Response.json({ delivered: true }, { status: 201, headers: NO_STORE });
  } catch {
    return Response.json({ error: "Welcome email delivery is temporarily unavailable." }, { status: 503, headers: NO_STORE });
  }
}
