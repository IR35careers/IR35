import { enableEmployerAutomation } from "@/lib/application-automation-consent";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { ContractorProfile } from "@/lib/workspace/types";

export const runtime = "nodejs";

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!token)
    return Response.json(
      { error: "Sign in again before updating application permissions." },
      { status: 401, headers: NO_STORE },
    );

  try {
    const body = await readJsonBody<{
      applicationId?: string;
      consent?: string;
    }>(request, 5_000);
    if (
      !/^[0-9a-f-]{36}$/i.test(body.applicationId ?? "") ||
      body.consent !== "ALLOW_EMPLOYER_ACCOUNT_AUTOMATION"
    )
      return Response.json(
        { error: "Confirm the employer account permission before continuing." },
        { status: 400, headers: NO_STORE },
      );

    const admin = getSupabaseAdmin();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user)
      return Response.json(
        { error: "Your session has expired. Sign in again, then retry." },
        { status: 401, headers: NO_STORE },
      );
    const userId = authData.user.id;
    const [
      { data: packet, error: packetError },
      { data: profileRow, error: profileError },
    ] = await Promise.all([
      admin
        .from("application_packets")
        .select("id")
        .eq("id", body.applicationId)
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("application_profile")
        .eq("id", userId)
        .maybeSingle(),
    ]);
    if (packetError || profileError)
      throw new Error(packetError?.message || profileError?.message);
    if (!packet)
      return Response.json(
        { error: "This application could not be found in your account." },
        { status: 404, headers: NO_STORE },
      );

    const acceptedAt = new Date().toISOString();
    const profile = enableEmployerAutomation(
      (profileRow?.application_profile ?? {}) as ContractorProfile,
      acceptedAt,
    );
    const { error: saveError } = await admin.from("profiles").upsert({
      id: userId,
      application_profile: profile,
      updated_at: acceptedAt,
    });
    if (saveError) throw new Error(saveError.message);

    return Response.json(
      { ok: true, acceptedAt },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof RequestBodyError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: NO_STORE },
      );
    return Response.json(
      { error: "Application permissions could not be saved. Try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
