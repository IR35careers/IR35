import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { loadManagedJobSources } from "@/lib/ats/source-registry";
import { saveEmployerDestination, validRecruitmentEmail } from "@/lib/employer-destinations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

type PendingVerification = {
  logId: string;
  sourceId: string;
  sourceName: string;
  email: string;
  expiresAt: string;
  requestedBy: string;
};

function clean(value: unknown, max = 160): string {
  return typeof value === "string" ? value.replace(/[&<>"']/g, "").trim().slice(0, max) : "";
}

function page(title: string, message: string, action = ""): string {
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px"><section style="width:100%;max-width:560px;background:#fff;border:1px solid #dbe4ec;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,.08)"><div style="background:#052e2b;padding:24px 28px;color:#fff;font-size:18px;font-weight:700">IR35Careers</div><div style="padding:32px 28px"><h1 style="margin:0;font-size:26px;line-height:34px">${title}</h1><p style="margin:14px 0 0;color:#475569;font-size:15px;line-height:24px">${message}</p>${action}</div></section></main></body></html>`;
}

async function pendingVerification(token: string): Promise<PendingVerification | null> {
  if (!/^[0-9a-f]{64}$/i.test(token)) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = getSupabaseAdmin();
  const result = await admin
    .from("moderation_logs")
    .select("id, summary")
    .eq("run_type", "employer_destination_verification")
    .contains("summary", { token_hash: tokenHash })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const summary = result.data.summary as Record<string, unknown>;
  const sourceId = clean(summary.source_id, 220);
  const sourceName = clean(summary.source_name, 100);
  const email = clean(summary.email, 254).toLowerCase();
  const expiresAt = clean(summary.expires_at, 40);
  const requestedBy = clean(summary.requested_by, 254);
  if (!sourceId || !sourceName || !validRecruitmentEmail(email) || !Number.isFinite(new Date(expiresAt).getTime())) return null;
  return { logId: result.data.id, sourceId, sourceName, email, expiresAt, requestedBy };
}

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const pending = await pendingVerification(token);
  if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) {
    return new Response(page("Verification link unavailable", "This link is invalid or has expired. Ask the IR35Careers administrator to send a new verification email."), { status: 400, headers: HEADERS });
  }
  const action = `<form method="post" style="margin-top:24px"><input type="hidden" name="token" value="${token}"><button type="submit" style="width:100%;border:0;border-radius:11px;background:#059669;color:#fff;padding:14px 18px;font-size:15px;font-weight:700;cursor:pointer">Confirm application delivery</button></form><p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:19px">Confirm only if ${pending.email} is authorised to receive candidate applications for ${pending.sourceName}.</p>`;
  return new Response(page("Confirm recruitment delivery", `IR35Careers will deliver candidate-approved applications for ${pending.sourceName} to ${pending.email}.`, action), { headers: HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const pending = await pendingVerification(token);
  if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) {
    return new Response(page("Verification link unavailable", "This link is invalid or has expired. Ask the IR35Careers administrator to send a new verification email."), { status: 400, headers: HEADERS });
  }
  const admin = getSupabaseAdmin();
  const sources = await loadManagedJobSources(admin);
  if (!sources.some((source) => source.id === pending.sourceId)) {
    return new Response(page("Job source unavailable", "The associated public job source no longer exists in IR35Careers."), { status: 409, headers: HEADERS });
  }
  const now = new Date().toISOString();
  await saveEmployerDestination({
    sourceId: pending.sourceId,
    email: pending.email,
    enabled: true,
    verifiedAt: now,
    updatedAt: now,
  }, pending.email, admin);
  await admin.from("moderation_logs").insert({
    run_type: "employer_destination_verification",
    summary: {
      action: "verified",
      source_id: pending.sourceId,
      source_name: pending.sourceName,
      email: pending.email,
      request_log_id: pending.logId,
      verified_at: now,
      requested_by: pending.requestedBy,
    },
  });
  return new Response(page("Application delivery connected", `${pending.sourceName} can now receive candidate-approved applications from IR35Careers. You can close this page.`), { headers: HEADERS });
}

