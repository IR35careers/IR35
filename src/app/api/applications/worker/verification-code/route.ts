import { applicationWorkerConfig } from "@/lib/application-worker-auth";
import {
  ApplicationWorkerRequestError,
  readSignedApplicationWorkerJson,
} from "@/lib/application-worker-request";
import { waitForEmailVerificationCode } from "@/lib/email/wait-for-verification-code";
import {
  getResend,
  resendInboundConfig,
} from "@/lib/email/resend";
import {
  findResendVerificationEmail,
  storeRecoveredVerificationEmail,
} from "@/lib/email/resend-verification-sync";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function validRequest(value: unknown): value is {
  userId: string;
  applicationId: string;
  alias: string;
  requestedAfter: string;
  providerSync?: boolean;
} {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return Boolean(
    typeof body.userId === "string" &&
      uuid.test(body.userId) &&
      typeof body.applicationId === "string" &&
      uuid.test(body.applicationId) &&
      typeof body.alias === "string" &&
      body.alias.length <= 254 &&
      /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(body.alias) &&
      typeof body.requestedAfter === "string" &&
      Number.isFinite(new Date(body.requestedAfter).getTime()) &&
      new Date(body.requestedAfter).getTime() >= Date.now() - 30 * 60_000 &&
      (body.providerSync === undefined ||
        typeof body.providerSync === "boolean"),
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!applicationWorkerConfig().enabled)
      return Response.json(
        { error: "The application worker is not enabled." },
        { status: 503, headers: HEADERS },
      );
    const parsed = await readSignedApplicationWorkerJson(request, 10_000);
    if (!validRequest(parsed))
      return Response.json(
        { error: "The verification-code request is invalid." },
        { status: 400, headers: HEADERS },
      );
    const admin = getSupabaseAdmin();
    let code = await waitForEmailVerificationCode({
      admin,
      userId: parsed.userId,
      applicationId: parsed.applicationId,
      alias: parsed.alias,
      requestedAfter: parsed.requestedAfter,
      attempts: 1,
      intervalMs: 250,
    });
    let providerSynced = false;
    if (!code && parsed.providerSync) {
      const inbound = resendInboundConfig();
      if (inbound) {
        const providerEmail = await findResendVerificationEmail({
          resend: getResend(inbound),
          userId: parsed.userId,
          applicationId: parsed.applicationId,
          alias: parsed.alias,
          requestedAfter: parsed.requestedAfter,
        });
        if (providerEmail) {
          code = providerEmail.code;
          providerSynced = true;
          await storeRecoveredVerificationEmail({
            admin,
            userId: parsed.userId,
            applicationId: parsed.applicationId,
            email: providerEmail,
          });
        }
      }
    }
    return Response.json({ code, providerSynced }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ApplicationWorkerRequestError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: HEADERS },
      );
    return Response.json(
      { error: "The verification code could not be checked." },
      { status: 500, headers: HEADERS },
    );
  }
}
