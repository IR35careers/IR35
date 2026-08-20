import { NextResponse } from "next/server";
import { buildResumeDocx, buildResumePdf } from "@/lib/resume/export";
import type { ResumeExportRequest } from "@/lib/resume/types";

export const runtime = "nodejs";

const MAX_TEXT_CHARS = 150_000;

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
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    let body: Partial<ResumeExportRequest>;
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const encoded = form.get("payload");
      if (typeof encoded !== "string" || encoded.length > 200_000) return invalid("The export request is invalid.", 413);
      body = JSON.parse(encoded) as Partial<ResumeExportRequest>;
    } else {
      body = (await request.json()) as Partial<ResumeExportRequest>;
    }
    if (body.format !== "pdf" && body.format !== "docx") return invalid("Choose PDF or DOCX export.");
    if (!body.resumeText?.trim()) return invalid("The CV is empty.");
    if (body.resumeText.length > MAX_TEXT_CHARS) return invalid("The CV is too large to export.", 413);

    const payload: ResumeExportRequest = {
      format: body.format,
      resumeText: body.resumeText,
      candidateName: body.candidateName?.slice(0, 100) ?? "Candidate",
      jobTitle: body.jobTitle?.slice(0, 160) ?? "Selected role",
      companyName: body.companyName?.slice(0, 160) ?? "",
      versionLabel: body.versionLabel?.slice(0, 80) ?? "Approved version",
    };
    const bytes = body.format === "pdf" ? await buildResumePdf(payload) : await buildResumeDocx(payload);
    const filename = `${safeFilename(`${payload.candidateName}-CV`)}.${body.format}`;
    const responseContentType =
      body.format === "pdf"
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
    console.error("Resume export failed", error);
    return invalid("The CV could not be exported. Review the text and try again.", 422);
  }
}
