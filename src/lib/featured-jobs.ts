import type { JobListing } from "@/lib/job-types";

/**
 * Homepage previews must never imply an IR35 determination where the advert
 * does not provide enough evidence. Keep only confirmed statuses and, when
 * both are available, include at least one Inside and one Outside role.
 */
export function selectFeaturedJobs(jobs: JobListing[], limit = 3): JobListing[] {
  if (limit <= 0) return [];

  const confirmed = jobs.filter(
    (job) => job.ir35_status === "inside" || job.ir35_status === "outside"
  );
  const selectedIds = new Set<string>();
  const selected: JobListing[] = [];

  for (const status of ["outside", "inside"] as const) {
    const job = confirmed.find((candidate) => candidate.ir35_status === status);
    if (job && selected.length < limit) {
      selected.push(job);
      selectedIds.add(job.id);
    }
  }

  for (const job of confirmed) {
    if (selected.length >= limit) break;
    if (selectedIds.has(job.id)) continue;
    selected.push(job);
    selectedIds.add(job.id);
  }

  const sourceOrder = new Map(jobs.map((job, index) => [job.id, index]));
  return selected.sort(
    (left, right) => (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0)
  );
}
