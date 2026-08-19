import { NextResponse } from "next/server";
import { prepareApplication } from "@/lib/workspace/engine";
import type { PrepareApplicationInput } from "@/lib/workspace/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > 500_000) return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    const body = (await request.json()) as PrepareApplicationInput;
    const application = prepareApplication(body);
    return NextResponse.json({ application }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Application preparation failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}

