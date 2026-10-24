import { stackHealth } from "@/lib/stack-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await stackHealth();
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
