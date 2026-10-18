import { buildGoogleOAuthAuthorizeUrl } from "@/lib/google-oauth";
import { googleRedirectFallbackEnabled } from "@/lib/google-identity";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!googleRedirectFallbackEnabled()) return Response.json({ error: "Google redirect fallback is disabled. Use the secure Google button or email." }, { status: 404, headers: { "Cache-Control": "no-store" } });
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
