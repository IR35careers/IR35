import { verifyApplicationRunnerTestToken } from "@/lib/application-runner/test-token";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!verifyApplicationRunnerTestToken(token)) return new Response("Not found", { status: 404 });
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "utf8");
  return new Response(pdf, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=IR35Careers-Runner-Test-CV.pdf",
      "Content-Type": "application/pdf",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
