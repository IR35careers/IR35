import JobsBoard from "@/components/jobs/JobsBoard";
import { GET as publicSearch } from "@/app/api/jobs/search/route";
import { initialJobSearchSchema, publicSearchParams, type InitialJobSearch } from "@/lib/job-search-response";

export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Direct call to the existing anonymous/RLS GET: no public network round-trip,
  // request cookies, service-role elevation or diverging search implementation.
  let initial: InitialJobSearch | null = null;
  const params = publicSearchParams(await searchParams);
  try {
    const response = await publicSearch(new Request(`http://ssr.internal/api/jobs/search?${params}`));
    if (response.ok) initial = initialJobSearchSchema.parse(await response.json());
  } catch {
    // An actual outage remains retryable, never replaced by fictional rows.
  }
  return <JobsBoard initial={initial} query={params.toString()} />;
}
