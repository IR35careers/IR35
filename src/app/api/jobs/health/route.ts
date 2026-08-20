import { getPublicSourceHealth } from "@/lib/source-health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const summary = await getPublicSourceHealth();
    return Response.json(summary, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { status: "unavailable", error: "Feed health is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "public, s-maxage=30", "X-Content-Type-Options": "nosniff" } }
    );
  }
}
