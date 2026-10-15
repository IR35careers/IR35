import { revalidateTag } from "next/cache";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { JOB_DETAIL_COLUMNS } from "@/lib/public-jobs";
import { planJobQuality, type QualityJob } from "@/lib/processing/job-quality";

export async function repairJobQuality(mode: "preview" | "apply", expectedHash?: string) {
  const db = getSupabaseAdmin();
  const jobs: QualityJob[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from("jobs").select(`${JOB_DETAIL_COLUMNS},rate_confidence,rate_raw`)
      .is("expired_at", null).order("id").range(offset, offset + 499);
    if (error) throw new Error("Unable to inspect the complete public inventory");
    jobs.push(...(data ?? []) as unknown as QualityJob[]);
    if (!data || data.length < 500) break;
  }
  const plan = planJobQuality(jobs);
  if (mode === "preview") return { ...plan.counts, planHash: plan.planHash, changed: plan.changes.length };
  if (!expectedHash || expectedHash !== plan.planHash) throw new Error("Inventory changed; preview the repairs again before applying");
  const now = new Date().toISOString();
  // Save exact original values before any mutation; an operator can restore
  // these rows without deleting jobs or breaking historical applications.
  const { error: auditError } = await db.from("moderation_logs").insert({
    run_type: "job_quality_repair", summary: { phase: "planned", at: now, planHash: plan.planHash, counts: plan.counts, changes: plan.changes },
  });
  if (auditError) throw new Error("Repair audit could not be saved; no jobs changed");
  let applied = 0;
  for (const change of plan.changes) {
    const patch = { ...change.after };
    if (patch.expired_at === "REPAIR_TIME") patch.expired_at = now;
    let query = db.from("jobs").update(patch).eq("id", change.id).is("expired_at", null);
    // Optimistic field guards keep a concurrent source refresh from being overwritten.
    for (const [field, value] of Object.entries(change.before)) {
      if (field === "expired_at") continue;
      query = value === null ? query.is(field, null)
        : Array.isArray(value) ? query.contains(field, value).containedBy(field, value)
        : query.eq(field, value);
    }
    const { data, error } = await query.select("id");
    if (error) throw new Error(`Repair stopped after ${applied} changes; original values are in the repair audit`);
    if (data?.length) applied++;
  }
  revalidateTag("public-jobs", { expire: 0 });
  await db.from("moderation_logs").insert({ run_type: "job_quality_repair", summary: { phase: "completed", at: now, planHash: plan.planHash, counts: plan.counts, applied } });
  return { ...plan.counts, planHash: plan.planHash, applied, skippedConcurrentChanges: plan.changes.length - applied };
}
