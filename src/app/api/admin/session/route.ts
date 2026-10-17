import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_TTL_SECONDS,
  adminSessionCookieName,
  adminSessionCookieOptions,
  createAdminSession,
  isAdminRequestHost,
} from "@/lib/admin-session";
import { authorizeAdministrator, touchAdministratorLogin } from "@/lib/admin-access";
import { requestUser } from "@/lib/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request): Promise<Response> {
  if (!isAdminRequestHost(request)) return Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  const auth = await requestUser(request);
  if ("response" in auth) return auth.response;

  const email = auth.user.email?.trim().toLowerCase();
  const membership = email ? await authorizeAdministrator(email) : null;
  if (!email || !membership) {
    return Response.json({ error: "This account is not authorised for administration." }, { status: 403, headers: NO_STORE });
  }

  try {
    await touchAdministratorLogin(email, auth.user.id);
    const response = NextResponse.json({
      unlocked: true,
      expiresIn: ADMIN_SESSION_TTL_SECONDS,
      role: membership.role,
    }, { headers: NO_STORE });
    response.cookies.set(
      adminSessionCookieName(),
      createAdminSession({ id: auth.user.id, email }),
      adminSessionCookieOptions()
    );
    return response;
  } catch {
    return Response.json({ error: "Secure administration is not configured." }, { status: 503, headers: NO_STORE });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isAdminRequestHost(request)) return Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  const response = NextResponse.json({ locked: true }, { headers: NO_STORE });
  response.cookies.set(adminSessionCookieName(), "", adminSessionCookieOptions(0));
  return response;
}
