import { NextResponse } from "next/server";
import { prepareApplication } from "@/lib/workspace/engine";
import type { PrepareApplicationInput } from "@/lib/workspace/types";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { consumePublicRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  const rate = await consumePublicRateLimit(request, "application_prepare", 30, 10 * 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  try {
    const body = await readJsonBody<PrepareApplicationInput>(request, 500_000);
    const application = prepareApplication(body);
    return NextResponse.json({ application }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Application preparation failed." },
      { status: error instanceof RequestBodyError ? error.status : 400, headers: NO_STORE }
    );
  }
}
