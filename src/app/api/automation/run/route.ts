import { timingSafeEqual } from "node:crypto";
import { runScheduledAutoApply } from "@/lib/automation/scheduled-runner";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function secureTokenEqual(presented: string, expected: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 500, headers: NO_STORE },
    );
  }

  const authorized = secureTokenEqual(
    request.headers.get("authorization") ?? "",
    `Bearer ${secret}`,
  );
  if (!authorized) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  try {
    const origin =
      process.env.IR35CAREERS_APP_URL?.trim() || new URL(request.url).origin;
    const summary = await runScheduledAutoApply({ origin });
    console.info("scheduled_auto_apply_finished", {
      enabledAccounts: summary.enabledAccounts,
      accountsAttempted: summary.accountsAttempted,
      applicationsStarted: summary.applicationsStarted,
      needsUser: summary.needsUser,
      failed: summary.failed,
    });
    await getSupabaseAdmin()
      .from("moderation_logs")
      .insert({
        run_type: "scheduled_auto_apply",
        summary: {
          enabled_accounts: summary.enabledAccounts,
          accounts_attempted: summary.accountsAttempted,
          applications_started: summary.applicationsStarted,
          needs_user: summary.needsUser,
          failed: summary.failed,
          status: summary.failed > 0 ? "completed_with_issues" : "completed",
        },
      })
      .then(({ error: auditError }) => {
        if (auditError)
          console.warn("scheduled_auto_apply_audit_failed", {
            reason: auditError.message.slice(0, 240),
          });
      });
    return Response.json({ ok: true, summary }, { headers: NO_STORE });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : "unknown";
    console.error("scheduled_auto_apply_failed", {
      reason,
    });
    const failureAudit = await getSupabaseAdmin()
      .from("moderation_logs")
      .insert({
        run_type: "scheduled_auto_apply",
        summary: { status: "failed", reason },
      });
    if (failureAudit.error)
      console.warn("scheduled_auto_apply_audit_failed", {
        reason: failureAudit.error.message.slice(0, 240),
      });
    return Response.json(
      { ok: false, error: "The scheduled Auto Apply run could not complete." },
      { status: 500, headers: NO_STORE },
    );
  }
}
