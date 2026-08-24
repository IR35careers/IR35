import { describe, expect, it } from "vitest";
import JSZip from "jszip";
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

describe("Resume parsing route", () => {
  it("extracts text from a generated PDF", async () => {
    const bytes = await buildResumePdf(exportRequest);
    const response = await parseFile("alex.pdf", "application/pdf", bytes);
    const payload = (await response.json()) as {
      text: string;
      pageCount: number;
      extraction: { prefill: { fullName?: string }; detectedSkills: string[] };
    };
    expect(response.status).toBe(200);
    expect(payload.text).toContain("Alex Morgan");
    expect(payload.text).toContain("Terraform");
    expect(payload.pageCount).toBe(1);
    expect(payload.extraction.prefill.fullName).toBe("Alex Morgan");
    expect(payload.extraction.detectedSkills).toEqual(expect.arrayContaining(["AWS", "Terraform"]));
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

  it("rejects active PDF content before parsing", async () => {
    const response = await parseFile(
      "active.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.7\n1 0 obj <</OpenAction 2 0 R>>")
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/active or embedded content/i);
  });

  it("rejects embedded Word objects before extraction", async () => {
    const archive = new JSZip();
    archive.file("word/document.xml", "<w:document />");
    archive.file("word/embeddings/oleObject1.bin", "embedded content");
    const bytes = await archive.generateAsync({ type: "nodebuffer" });
    const response = await parseFile(
      "embedded.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/macros or embedded objects/i);
  });
});
