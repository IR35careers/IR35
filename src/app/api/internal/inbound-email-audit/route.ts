import { timingSafeEqual } from "node:crypto";
import { adminAllowlist } from "@/lib/admin-session";
import { runInboundEmailLoopAudit } from "@/lib/inbound-email-loop-audit";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function authorised(request: Request): boolean {
  const configured = process.env.INBOUND_AUDIT_SECRET?.trim() || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  if (configured.length < 32 || configured.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
}

async function auditOwner(): Promise<{ id: string; email: string } | null> {
  const allowed = new Set(adminAllowlist());
  if (!allowed.size) return null;
  const client = getSupabaseAdmin();
  for (let page = 1; page <= 20; page += 1) {
    const users = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (users.error) throw users.error;
    const found = users.data.users.find((user) => {
      const email = user.email?.trim().toLowerCase();
      return Boolean(email && allowed.has(email));
    });
    if (found?.email) return { id: found.id, email: found.email.trim().toLowerCase() };
    if (users.data.users.length < 200) break;
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request))
    return Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE });

  try {
    const owner = await auditOwner();
    if (!owner)
      return Response.json(
        { error: "No authorised audit account is configured." },
        { status: 503, headers: NO_STORE },
      );
    const result = await runInboundEmailLoopAudit({
      client: getSupabaseAdmin(),
      userId: owner.id,
      email: owner.email,
    });
    return Response.json(result, {
      status: result.ok ? 201 : 503,
      headers: NO_STORE,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The inbound email audit failed.",
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
