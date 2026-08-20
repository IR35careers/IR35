import { getPublicJob } from "@/lib/public-jobs";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  const job = await getPublicJob(id);

  if (!job) {
    return Response.json(
      { error: "Active contract not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    {
      job,
      listing_url: `https://www.ir35careers.com/jobs/${job.id}`,
      generated_at: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}
