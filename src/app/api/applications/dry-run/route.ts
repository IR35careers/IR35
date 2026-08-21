import { NextResponse } from "next/server";
import { issueDryRunReceipt } from "@/lib/workspace/engine";
import type { ApplicationRecord } from "@/lib/workspace/types";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { consumePublicRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rate = await consumePublicRateLimit(request, "application_dry_run", 30, 10 * 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  try {
    const body = await readJsonBody<{ application?: ApplicationRecord; approval?: string }>(request, 600_000);
    if (body.approval !== "APPROVE_DRY_RUN" || !body.application) {
      return NextResponse.json({ error: "Explicit dry-run approval is required." }, { status: 400 });
    }
    const receipt = issueDryRunReceipt(body.application);
    return NextResponse.json({ receipt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dry run failed." },
      { status: error instanceof RequestBodyError ? error.status : 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
