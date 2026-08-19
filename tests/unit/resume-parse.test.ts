import { describe, expect, it } from "vitest";
import { POST as parseResume } from "@/app/api/resume/parse/route";
import { buildResumeDocx, buildResumePdf } from "@/lib/resume/export";
import type { ResumeExportRequest } from "@/lib/resume/types";

const exportRequest: ResumeExportRequest = {
  format: "pdf",
  candidateName: "Alex Morgan",
  companyName: "Northstar Digital",
  jobTitle: "Senior DevOps Engineer",
  versionLabel: "Approved v1",
  resumeText: `Alex Morgan
alex@example.com

PROFILE
AWS and Terraform contractor.

EXPERIENCE
- Built reliable AWS services with Terraform.`,
};

async function parseFile(filename: string, type: string, bytes: Buffer) {
  const formData = new FormData();
  formData.append("file", new File([new Uint8Array(bytes)], filename, { type }));
  return parseResume(new Request("http://localhost/api/resume/parse", { method: "POST", body: formData }));
}

describe("CV parsing route", () => {
  it("extracts text from a generated PDF", async () => {
    const bytes = await buildResumePdf(exportRequest);
    const response = await parseFile("alex.pdf", "application/pdf", bytes);
    const payload = (await response.json()) as { text: string; pageCount: number };
    expect(response.status).toBe(200);
    expect(payload.text).toContain("Alex Morgan");
    expect(payload.text).toContain("Terraform");
    expect(payload.pageCount).toBe(1);
  });

  it("extracts text from a generated DOCX", async () => {
    const bytes = await buildResumeDocx({ ...exportRequest, format: "docx" });
    const response = await parseFile(
      "alex.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes
    );
    const payload = (await response.json()) as { text: string };
    expect(response.status).toBe(200);
    expect(payload.text).toContain("Alex Morgan");
    expect(payload.text).toContain("Terraform");
  });

  it("rejects an extension-spoofed PDF", async () => {
    const response = await parseFile("not-really.pdf", "application/pdf", Buffer.from("not a pdf"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That file is not a valid PDF." });
  });
});
