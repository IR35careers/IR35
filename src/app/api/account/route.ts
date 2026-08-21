import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getStripe, stripeManagementConfig } from "@/lib/billing/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_PRIVATE_FILES = 10_000;

async function listPrivateFiles(
  admin: ReturnType<typeof getSupabaseAdmin>,
  prefix: string,
  depth = 0,
  collected: string[] = [],
): Promise<string[]> {
  if (depth > 8) throw new Error("storage-depth-limit");
  for (let offset = 0; ; offset += 1_000) {
    const listed = await admin.storage.from("cvs").list(prefix, { limit: 1_000, offset });
    if (listed.error) throw new Error("storage-list-failed");
    for (const entry of listed.data) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) collected.push(path);
      else await listPrivateFiles(admin, path, depth + 1, collected);
      if (collected.length > MAX_PRIVATE_FILES) throw new Error("storage-file-limit");
    }
    if (listed.data.length < 1_000) break;
  }
  return collected;
}

async function authenticate(request: Request): Promise<{ user: User } | { response: NextResponse }> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return { response: NextResponse.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE }) };
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return { response: NextResponse.json({ error: "Your session is no longer valid." }, { status: 401, headers: NO_STORE }) };
  return { user: data.user };
}

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const admin = getSupabaseAdmin();
  const userId = auth.user.id;

  const [profile, savedJobs, alerts, resumes, packets, events, alias, messages, automation, runs, entitlement, billingConsents] = await Promise.all([
    admin.from("profiles").select("*").eq("id", userId).maybeSingle(),
    admin.from("saved_jobs").select("status, created_at, job_id, jobs(title, company_name, location, apply_url)").eq("user_id", userId),
    admin.from("job_alerts").select("*").eq("user_id", userId),
    admin.from("resume_versions").select("*").eq("user_id", userId),
    admin.from("application_packets").select("*").eq("user_id", userId),
    admin.from("application_events").select("*").eq("user_id", userId),
    admin.from("inbox_aliases").select("*").eq("user_id", userId).maybeSingle(),
    admin.from("inbox_messages").select("*").eq("user_id", userId),
    admin.from("automation_rules").select("*").eq("user_id", userId).maybeSingle(),
    admin.from("automation_runs").select("*").eq("user_id", userId),
    admin.from("user_entitlements").select("plan, preparation_credits, billing_state, updated_at").eq("user_id", userId).maybeSingle(),
    admin.from("billing_consents").select("policy_version, price_label, immediate_access_requested, status, consented_at").eq("user_id", userId).order("consented_at", { ascending: false }),
  ]);

  const results = [profile, savedJobs, alerts, resumes, packets, events, alias, messages, automation, runs, entitlement];
  const failure = results.find((result) => result.error);
  if (failure?.error) {
    return NextResponse.json({ error: "Your export could not be prepared. Please try again." }, { status: 500, headers: NO_STORE });
  }
  const billingConsentError = billingConsents.error;
  if (billingConsentError && !["42P01", "PGRST205"].includes(billingConsentError.code ?? "")) {
    return NextResponse.json({ error: "Your export could not be prepared. Please try again." }, { status: 500, headers: NO_STORE });
  }

  return NextResponse.json({
    export_version: "2026-08-20",
    exported_at: new Date().toISOString(),
    account: {
      id: userId,
      email: auth.user.email,
      created_at: auth.user.created_at,
      last_sign_in_at: auth.user.last_sign_in_at,
      profile: profile.data,
    },
    saved_jobs: savedJobs.data ?? [],
    job_alerts: alerts.data ?? [],
    resume_versions: resumes.data ?? [],
    application_packets: packets.data ?? [],
    application_events: events.data ?? [],
    inbox_alias: alias.data,
    inbox_messages: messages.data ?? [],
    automation_rules: automation.data,
    automation_runs: runs.data ?? [],
    entitlement: entitlement.data,
    billing_consents: billingConsentError ? [] : billingConsents.data ?? [],
  }, { headers: { ...NO_STORE, "Content-Disposition": "attachment; filename=ir35careers-account-export.json" } });
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  let body: { email?: string; confirmation?: string };
  try {
    body = await readJsonBody<typeof body>(request, 2_000);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE });
  }

  const accountEmail = (auth.user.email ?? "").trim().toLowerCase();
  if (!accountEmail || body.email?.trim().toLowerCase() !== accountEmail || body.confirmation !== "DELETE") {
    return NextResponse.json({ error: "Enter the signed-in email address and the confirmation word exactly." }, { status: 400, headers: NO_STORE });
  }

  const admin = getSupabaseAdmin();
  const entitlement = await admin
    .from("user_entitlements")
    .select("provider_customer_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (entitlement.error) {
    return NextResponse.json({ error: "Your billing status could not be checked. Nothing was deleted." }, { status: 500, headers: NO_STORE });
  }

  const providerCustomerId = entitlement.data?.provider_customer_id;
  if (providerCustomerId) {
    const config = stripeManagementConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Your billing account must be disconnected before deletion. Please retry later or contact support. Nothing was deleted." },
        { status: 503, headers: NO_STORE },
      );
    }
    try {
      await getStripe(config).customers.del(providerCustomerId, {}, { idempotencyKey: `delete-account-${auth.user.id}` });
    } catch {
      return NextResponse.json(
        { error: "Your billing account could not be cancelled. Nothing was deleted; please retry or contact support." },
        { status: 502, headers: NO_STORE },
      );
    }
  }

  let privateFiles: string[];
  try {
    privateFiles = await listPrivateFiles(admin, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Private CV files could not be inventoried safely. Nothing else was deleted." }, { status: 500, headers: NO_STORE });
  }
  for (let start = 0; start < privateFiles.length; start += 100) {
    const removal = await admin.storage.from("cvs").remove(privateFiles.slice(start, start + 100));
    if (removal.error) return NextResponse.json({ error: "The account was not deleted. Some private CV files may already have been removed; please contact support before retrying." }, { status: 500, headers: NO_STORE });
  }

  const deleted = await admin.auth.admin.deleteUser(auth.user.id);
  if (deleted.error) return NextResponse.json({ error: "The account could not be deleted. Please contact support." }, { status: 500, headers: NO_STORE });

  return NextResponse.json({ deleted: true }, { headers: NO_STORE });
}
