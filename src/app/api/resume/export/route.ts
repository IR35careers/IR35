import { NextResponse } from "next/server";
import { buildResumeDocx, buildResumePdf } from "@/lib/resume/export";
import type { ResumeExportRequest } from "@/lib/resume/types";
import { z } from "zod";
import { resolveCandidateName } from "@/lib/candidate-name";
import { readFormDataBody, readJsonBody, readTextBody, RequestBodyError } from "@/lib/security/request-body";
import { consumePublicRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const MAX_TEXT_CHARS = 150_000;
const exportSchema = z.object({
  format: z.enum(["pdf", "docx"]), resumeText: z.string().min(1).max(MAX_TEXT_CHARS),
  candidateName: z.string().max(100).default("Candidate"),
  jobTitle: z.string().max(5000).transform(value => value.slice(0, 160)).default("Selected role"),
  companyName: z.string().max(5000).transform(value => value.slice(0, 160)).default(""),
  versionLabel: z.string().max(5000).transform(value => value.slice(0, 80)).default("Approved version"),
});

function safeFilename(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9 _-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "tailored-cv";
}

function invalid(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const rate = await consumePublicRateLimit(request, "resume_export", 20, 10 * 60_000);
  if (!rate.allowed) return rateLimitResponse(rate.retryAfter);
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    let body: unknown;
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const encoded = contentType.includes("multipart/form-data")
        ? (await readFormDataBody(request, 250_000)).get("payload")
        : new URLSearchParams(await readTextBody(request, 250_000)).get("payload");
      if (typeof encoded !== "string" || encoded.length > 200_000) return invalid("The export request is invalid.", 413);
      body = JSON.parse(encoded);
    } else {
      body = await readJsonBody<unknown>(request, 250_000);
    }
    const parsed = exportSchema.safeParse(body);
    if (!parsed.success) return invalid("The CV export request is invalid. Check the format, text and name.",
      parsed.error.issues.some(issue => issue.code === "too_big") ? 413 : 400);
    const input = parsed.data;
    if (!input.resumeText.trim()) return invalid("The CV is empty.");
    const name = resolveCandidateName(input.candidateName, input.resumeText);
    if (!name) return invalid("Confirm your name before exporting the CV; a section heading cannot be used as your identity.");
    const payload: ResumeExportRequest = {
      ...input, candidateName: name,
    };
    const bytes = input.format === "pdf" ? await buildResumePdf(payload) : await buildResumeDocx(payload);
    const filename = `${safeFilename(`${name}-CV`)}.${input.format}`;
    const responseContentType =
      input.format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": responseContentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof RequestBodyError) return invalid(error.message, error.status);
    console.error("resume_export_failed", {
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return invalid("The CV could not be exported. Review the text and try again.", 422);
  }
}
