import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { JOB_LIST_COLUMNS, type JobListing } from "@/lib/job-types";
import type { SeoFilters } from "@/lib/seo-pages";
import { isProfessionalRole } from "@/lib/processing/job-processor";
import { isPrimarySapRole } from "@/lib/processing/skills-extractor";

const BATCH = 500;
// Cache public data, never HTML containing a per-request security nonce. Batches
// stay below the Data Cache item limit and work around PostgREST's row cap.
const readBatch = unstable_cache(async (offset: number) => {
  const { data, error } = await supabase.from("jobs").select(JOB_LIST_COLUMNS)
    .is("expired_at", null).order("id").range(offset, offset + BATCH - 1);
  if (error) throw new Error("Public contract inventory is temporarily unavailable");
  return (data ?? []) as unknown as JobListing[];
}, ["public-job-inventory-v2"], { revalidate: 300, tags: ["public-jobs"] });

export function isRelevantPublicJob(job: JobListing): boolean {
  return job.source_domain !== "demo.ir35careers.local" && isProfessionalRole(job.title, {
    min: job.rate_min, max: job.rate_max, type: job.rate_type,
    currency: job.rate_currency, confidence: "low", raw: "",
  });
}

export function matchesSeoFilters(job: JobListing, filters: SeoFilters): boolean {
  return (!filters.skill || (job.skills.includes(filters.skill)
      && (filters.skill !== "SAP" || isPrimarySapRole(job.title, "SAP"))))
    && (!filters.location || job.location.toLowerCase().includes(filters.location.toLowerCase()))
    && (!filters.ir35 || job.ir35_status === filters.ir35)
    && (!filters.remote || job.remote_type === "remote");
}

export const getPublicJobInventory = cache(async (): Promise<JobListing[]> => {
  if (!isSupabaseConfigured()) return [];
  const jobs: JobListing[] = [];
  for (let offset = 0; ; offset += BATCH) {
    const batch = await readBatch(offset);
    jobs.push(...batch.filter(isRelevantPublicJob));
    if (batch.length < BATCH) break;
  }
  return jobs.sort((a, b) => (b.posted_at ?? b.first_seen_at).localeCompare(a.posted_at ?? a.first_seen_at));
});

export async function getContractPageData(filters: SeoFilters) {
  const matches = (await getPublicJobInventory()).filter(job => matchesSeoFilters(job, filters));
  return { jobs: matches.slice(0, 20), total: matches.length };
}
