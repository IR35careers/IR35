import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function requestUser(request: Request): Promise<{ user: User } | { response: Response }> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return { response: Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE }) };
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return { response: Response.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE }) };
  return { user: data.user };
}
