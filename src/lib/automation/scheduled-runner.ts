import { createScheduledAutoApplyAuthorization } from "@/lib/automation/internal-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type AutoApplyPayload = {
  state?: string;
  message?: string;
  error?: string;
  application?: {
    id?: string;
    job?: { id?: string };
  };
};

type AccountResult = {
  userId: string;
  started: number;
  state: string;
  jobIds: string[];
};

export type ScheduledAutoApplySummary = {
  enabledAccounts: number;
  accountsAttempted: number;
  applicationsStarted: number;
  needsUser: number;
  failed: number;
  results: AccountResult[];
};

const DEFAULT_GLOBAL_BATCH_LIMIT = 25;

function globalBatchLimit(): number {
  const configured = Number(process.env.AUTO_APPLY_DAILY_BATCH_LIMIT ?? "");
  if (!Number.isFinite(configured)) return DEFAULT_GLOBAL_BATCH_LIMIT;
  return Math.max(1, Math.min(Math.round(configured), 25));
}

export function orderScheduledAccounts<T extends { userId: string }>(
  accounts: T[],
  lastRunAt: ReadonlyMap<string, string>,
): T[] {
  return [...accounts].sort((left, right) => {
    const leftRun = Date.parse(lastRunAt.get(left.userId) ?? "");
    const rightRun = Date.parse(lastRunAt.get(right.userId) ?? "");
    const leftTime = Number.isFinite(leftRun) ? leftRun : 0;
    const rightTime = Number.isFinite(rightRun) ? rightRun : 0;
    return leftTime - rightTime || left.userId.localeCompare(right.userId);
  });
}

function safeOrigin(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error("The Auto Apply scheduler requires a secure app origin.");
  return url.origin;
}

export async function runScheduledAutoApply(input: {
  origin: string;
  fetchImpl?: typeof fetch;
  batchLimit?: number;
}): Promise<ScheduledAutoApplySummary> {
  const admin = getSupabaseAdmin();
  const fetchImpl = input.fetchImpl ?? fetch;
  const origin = safeOrigin(input.origin);
  const batchLimit = Math.max(
    1,
    Math.min(input.batchLimit ?? globalBatchLimit(), 25),
  );
  const { data: rows, error } = await admin
    .from("automation_rules")
    .select("user_id, daily_limit, updated_at")
    .eq("enabled", true)
    .order("updated_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);

  const unorderedAccounts = (rows ?? []).map((row) => ({
    userId: String(row.user_id ?? ""),
    dailyLimit: Math.max(1, Math.min(Number(row.daily_limit ?? 1), 25)),
  })).filter((row) => /^[0-9a-f-]{36}$/i.test(row.userId));
  const userIds = unorderedAccounts.map((account) => account.userId);
  const lastRunAt = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: recentRuns, error: runsError } = await admin
      .from("automation_runs")
      .select("user_id, created_at")
      .in("user_id", userIds)
      .order("created_at", { ascending: false })
      .limit(Math.min(userIds.length * 4, 400));
    if (runsError) throw new Error(runsError.message);
    for (const run of recentRuns ?? []) {
      const userId = String(run.user_id ?? "");
      if (!lastRunAt.has(userId)) lastRunAt.set(userId, String(run.created_at ?? ""));
    }
  }
  const accounts = orderScheduledAccounts(unorderedAccounts, lastRunAt);
  const summary: ScheduledAutoApplySummary = {
    enabledAccounts: accounts.length,
    accountsAttempted: 0,
    applicationsStarted: 0,
    needsUser: 0,
    failed: 0,
    results: [],
  };
  const active = new Map(
    accounts.map((account) => [account.userId, { ...account, started: 0 }]),
  );
  const resultByUser = new Map<string, AccountResult>();

  while (active.size > 0 && summary.applicationsStarted < batchLimit) {
    for (const account of [...active.values()]) {
      if (summary.applicationsStarted >= batchLimit) break;
      if (account.started >= account.dailyLimit) {
        active.delete(account.userId);
        continue;
      }

      const authorization = createScheduledAutoApplyAuthorization({
        userId: account.userId,
      });
      if (!authorization) {
        summary.failed += 1;
        active.delete(account.userId);
        continue;
      }
      if (!resultByUser.has(account.userId)) {
        summary.accountsAttempted += 1;
        resultByUser.set(account.userId, {
          userId: account.userId,
          started: 0,
          state: "started",
          jobIds: [],
        });
      }
      const accountResult = resultByUser.get(account.userId) as AccountResult;

      try {
        const response = await fetchImpl(`${origin}/api/automation/apply-next`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ir35-auto-apply-timestamp": authorization.timestamp,
            "x-ir35-auto-apply-signature": authorization.signature,
          },
          body: JSON.stringify({ internalUserId: account.userId }),
          cache: "no-store",
          signal: AbortSignal.timeout(60_000),
        });
        const payload = (await response.json().catch(() => ({}))) as AutoApplyPayload;
        const state = payload.state || (response.ok ? "processing" : "failed");
        accountResult.state = state;

        if (state === "needs_user") {
          summary.needsUser += 1;
          active.delete(account.userId);
          continue;
        }
        if (
          state === "no_match" ||
          state === "limit_reached" ||
          state === "premium_required" ||
          !response.ok
        ) {
          if (!response.ok && state !== "limit_reached") summary.failed += 1;
          active.delete(account.userId);
          continue;
        }

        const jobId = String(payload.application?.job?.id ?? "");
        if (jobId) accountResult.jobIds.push(jobId);
        account.started += 1;
        accountResult.started += 1;
        summary.applicationsStarted += 1;
      } catch {
        accountResult.state = "failed";
        summary.failed += 1;
        active.delete(account.userId);
      }
    }
  }

  summary.results = [...resultByUser.values()];
  await Promise.all(
    summary.results.map((result) =>
      admin.from("automation_runs").insert({
        user_id: result.userId,
        mode: "dry_run",
        matching_job_ids: result.jobIds,
        skipped: [
          {
            type: "scheduled_auto_apply",
            state: result.state,
            applicationsStarted: result.started,
          },
        ],
      }),
    ),
  ).catch(() => undefined);

  return summary;
}
