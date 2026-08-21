import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { consumePublicRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function clean(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function POST(request: Request) {
  const rate = await consumePublicRateLimit(request, "contact", 5, 60 * 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  try {
    const body = await readJsonBody<Record<string, unknown>>(request, 25_000);
    if (clean(body.website, 200)) return NextResponse.json({ accepted: true }, { status: 202, headers: NO_STORE });
    const name = clean(body.name, 120);
    const email = clean(body.email, 254).toLowerCase();
    const company = clean(body.company, 160);
    const message = clean(body.message, 5_000);
    if (name.length < 2) return NextResponse.json({ error: "Add your name." }, { status: 400, headers: NO_STORE });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Add a valid email address." }, { status: 400, headers: NO_STORE });
    if (message.length < 20) return NextResponse.json({ error: "Tell us a little more so we can help." }, { status: 400, headers: NO_STORE });

    const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
    if (!configured) {
      if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Contact storage is not configured." }, { status: 503, headers: NO_STORE });
      return NextResponse.json({ accepted: true, preview: true, message: "Form validated in local preview. Nothing was transmitted or stored." }, { status: 202, headers: NO_STORE });
    }

    const { error } = await getSupabaseAdmin().from("contact_requests").insert({ name, email, company, message });
    if (error) throw new Error(error.message);
    return NextResponse.json({ accepted: true, preview: false, message: "Thanks, your enquiry has been received." }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof RequestBodyError) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    return NextResponse.json({ error: "We could not save your enquiry. Please try again." }, { status: 500, headers: NO_STORE });
  }
}
