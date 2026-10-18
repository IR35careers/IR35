import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { spacedIdentityPdf } from "../helpers/cv-identity-fixture";
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
  it.each(["literal spaces", "PDF glyph spacing"] as const)("extracts identity from a real synthetic PDF with %s, not technical headings", async kind => {
    const bytes = await spacedIdentityPdf(kind);
    const response = await parseFile("spaced-cv.pdf", "application/pdf", bytes);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.extraction.prefill.fullName).toBe(kind === "literal spaces" ? "ALEX MORGAN" : "Alex Morgan");
    expect(payload.extraction.prefill.location).toBe("Bristol, UK");
    expect(payload.extraction.detectedSkills).toContain("Terraform");
  });

  it.each([
    ["sharepoint.pdf", "application/pdf"], ["sharepoint.txt", "text/plain"],
  ])("explains a saved web page rather than parsing it as a CV: %s", async (filename, type) => {
    const response = await parseFile(filename, type, Buffer.from("\uFEFF<!-- saved page -->\n<!DOCTYPE html><html><body>SharePoint document viewer</body></html>"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/saved web page.*SharePoint.*Download or Export/i);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("requests identity review instead of naming a skills-only upload after a heading", async () => {
    const response = await parseFile("skills.txt", "text/plain", Buffer.from("Cloud Platforms\nRBAC, IAM\nTECHNICAL SKILLS\nAWS, Terraform"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.extraction.prefill.fullName).toBeUndefined();
    expect(payload.warnings[0]).toMatch(/confirm your name.*not guessed/i);
  });

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
