import { NextResponse } from "next/server";
import { issueDryRunReceipt } from "@/lib/workspace/engine";
import type { ApplicationRecord } from "@/lib/workspace/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { application?: ApplicationRecord; approval?: string };
    if (body.approval !== "APPROVE_DRY_RUN" || !body.application) {
      return NextResponse.json({ error: "Explicit dry-run approval is required." }, { status: 400 });
    }
    const receipt = issueDryRunReceipt(body.application);
    return NextResponse.json({ receipt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dry run failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
