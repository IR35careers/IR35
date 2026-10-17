import { z } from "zod";
import { continuationDestinationCandidates } from "@/lib/application-continuation-destination";
import { applicationDeliveryStatusSchema, isDeliveryInFlight } from "@/lib/application-lifecycle";
import { loadPortalSession } from "@/lib/application-portal-session";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { validatePublicHttpsUrl } from "@/lib/security/public-url";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;
const EXTENSION_ORIGIN = "chrome-extension://cmfcgaflmkipmmjkcneoobgkdpfkfeoa";
const packetSchema = z.object({
  id: z.uuid(), user_id: z.uuid(), truth_approved: z.boolean(), materials_approved: z.boolean(),
  delivery_status: applicationDeliveryStatusSchema,
  job_snapshot: z.object({ apply_url: z.string() }),
});
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open_employer"), applicationId: z.uuid() }),
  z.object({ action: z.literal("confirm_manual"), applicationId: z.uuid() }),
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("result") }),
]);
function headers(request: Request): Record<string, string> {
  return {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    ...(request.headers.get("origin") === EXTENSION_ORIGIN ? {
      "Access-Control-Allow-Origin": EXTENSION_ORIGIN,
      "Access-Control-Allow-Headers": "Content-Type, X-IR35-Handoff",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin",
    } : {}),
  };
}
function retired(request: Request) {
  return Response.json({
    error: "The legacy browser assistant has been retired. Return to your saved application to view its status or explicitly retry. Opening the employer site does not start another automatic attempt.",
  }, { status: 410, headers: headers(request) });
}
export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: headers(request) });
}
// Old opaque extension tokens may not export private CVs, verification codes or
// write delivery outcomes after the authoritative worker lifecycle is installed.
export function GET(request: Request) { return retired(request); }

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = bodySchema.safeParse(await readJsonBody<unknown>(request, 150_000));
    if (!parsed.success) return Response.json({ error: "Application action or reference is invalid." }, { status: 400, headers: headers(request) });
    const body = parsed.data;
    if (body.action === "create" || body.action === "result") return retired(request);

    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || !authorization.slice(7))
      return Response.json({ error: "Sign in again before continuing this application." }, { status: 401, headers: headers(request) });
    const admin = getSupabaseAdmin();
    const auth = await admin.auth.getUser(authorization.slice(7));
    if (auth.error || !auth.data.user)
      return Response.json({ error: "Your session expired. Sign in again, then retry." }, { status: 401, headers: headers(request) });
    const userId = auth.data.user.id;
    const row = await admin.from("application_packets")
      .select("id,user_id,truth_approved,materials_approved,delivery_status,job_snapshot")
      .eq("id", body.applicationId).eq("user_id", userId).maybeSingle();
    if (row.error) throw new Error("Application lookup failed.");
    if (!row.data) return Response.json({ error: "Application was not found." }, { status: 404, headers: headers(request) });
    const packet = packetSchema.parse(row.data);
    if (packet.user_id !== userId) return Response.json({ error: "Application was not found." }, { status: 404, headers: headers(request) });
    if (!packet.truth_approved || !packet.materials_approved)
      return Response.json({ error: "Review and approve the application materials before continuing." }, { status: 409, headers: headers(request) });

    if (body.action === "confirm_manual") {
      if (isDeliveryInFlight(packet.delivery_status))
        return Response.json({ error: "An automatic attempt is still in flight. Wait for its saved outcome before reporting a manual submission." }, { status: 409, headers: headers(request) });
      if (packet.delivery_status === "submitted")
        return Response.json({ reported: false, deliveryStatus: "submitted", message: "An employer confirmation is already saved." }, { headers: headers(request) });
      // A contractor report is useful history, not an employer receipt. Never
      // manufacture a provider ID or overwrite terminal/worker delivery state.
      const result = await admin.from("application_events").upsert({
        user_id: userId, application_id: packet.id, event_type: "note",
        label: "Contractor reported an external submission",
        metadata: { confirmationSource: "contractor", verified: false },
        idempotency_key: `manual-report:${packet.id}`,
      }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true });
      if (result.error) throw new Error("The contractor report could not be saved.");
      return Response.json({
        reported: true, deliveryStatus: packet.delivery_status,
        message: "Your employer-page submission report is saved in the activity history. Automatic delivery status is unchanged; this is not an employer-verified receipt.",
      }, { status: 202, headers: headers(request) });
    }

    if (isDeliveryInFlight(packet.delivery_status))
      return Response.json({ error: "An automatic attempt is still in flight. View its progress before opening a second application on the employer site." }, { status: 409, headers: headers(request) });
    const [portal, submission] = await Promise.all([
      loadPortalSession({ admin, userId, applicationId: packet.id }).catch(() => null),
      admin.from("application_submissions").select("receipt").eq("user_id", userId)
        .eq("application_id", packet.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (submission.error) throw new Error("Employer destination lookup failed.");
    for (const candidate of continuationDestinationCandidates({
      savedSessionUrl: portal?.currentUrl, receipt: submission.data?.receipt,
      approvedJobUrl: packet.job_snapshot.apply_url,
    })) {
      try {
        const destination = await validatePublicHttpsUrl(candidate);
        destination.hash = "";
        return Response.json({ employerUrl: destination.toString(), automatic: false }, { headers: headers(request) });
      } catch { /* Try the next durable, validated destination. */ }
    }
    return Response.json({ error: "The employer application destination is no longer available." }, { status: 409, headers: headers(request) });
  } catch (error) {
    if (error instanceof RequestBodyError)
      return Response.json({ error: error.message }, { status: error.status, headers: headers(request) });
    return Response.json({
      error: error instanceof z.ZodError
        ? "The saved application lifecycle is unavailable. Reload or contact support; no status was changed."
        : "The employer-page action could not be completed. Your saved application status has not been reset.",
    }, { status: 502, headers: headers(request) });
  }
}
