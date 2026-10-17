import { applicationWorkerConfig } from "@/lib/application-worker-auth";
import {
  ApplicationWorkerRequestError,
  readSignedApplicationWorkerJson,
} from "@/lib/application-worker-request";
import { waitForEmailActionLink } from "@/lib/email/action-link";
import {
  findResendActionEmail,
  storeRecoveredVerificationEmail,
} from "@/lib/email/resend-verification-sync";
import { getResend, resendInboundConfig } from "@/lib/email/resend";
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
        { error: "The employer email-action request is invalid." },
        { status: 400, headers: HEADERS },
      );
    const admin = getSupabaseAdmin();
    let actionLink = await waitForEmailActionLink({
      admin,
      userId: parsed.userId,
      applicationId: parsed.applicationId,
      alias: parsed.alias,
      requestedAfter: parsed.requestedAfter,
      attempts: 1,
      intervalMs: 250,
    });
    let providerSynced = false;
    if (!actionLink && parsed.providerSync) {
      const inbound = resendInboundConfig();
      if (inbound) {
        const providerEmail = await findResendActionEmail({
          resend: getResend(inbound),
          userId: parsed.userId,
          applicationId: parsed.applicationId,
          alias: parsed.alias,
          requestedAfter: parsed.requestedAfter,
        });
        if (providerEmail) {
          actionLink = providerEmail.actionLink;
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
    return Response.json(
      { actionLink, providerSynced },
      { headers: HEADERS },
    );
  } catch (error) {
    if (error instanceof ApplicationWorkerRequestError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: HEADERS },
      );
    return Response.json(
      { error: "The employer email action could not be checked." },
      { status: 500, headers: HEADERS },
    );
  }
}
