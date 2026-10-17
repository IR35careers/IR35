import { buildGoogleOAuthAuthorizeUrl } from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    return Response.json(
      { error: "Google sign-in is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const requestUrl = new URL(request.url);
    const authorizeUrl = buildGoogleOAuthAuthorizeUrl({
      requestOrigin: requestUrl.origin,
      requestedPath: requestUrl.searchParams.get("next"),
      supabaseUrl,
      selectAccount: requestUrl.searchParams.get("select_account") === "1",
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizeUrl,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Google sign-in could not be started." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
