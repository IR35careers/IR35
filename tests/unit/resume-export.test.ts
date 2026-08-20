import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { buildResumeDocx, buildResumePdf } from "@/lib/resume/export";
import type { ResumeExportRequest } from "@/lib/resume/types";

const request: ResumeExportRequest = {
  format: "pdf",
  candidateName: "Alex Morgan",
  companyName: "Northstar Digital",
  jobTitle: "Senior DevOps Engineer",
  versionLabel: "Approved v1",
  resumeText: `Alex Morgan
alex@example.com | +44 7700 900123

PROFILE
Cloud contractor with AWS and Terraform delivery experience.

EXPERIENCE
- Built reusable Terraform modules.
- Improved AWS platform reliability by 28%.`,
};

describe("CV exports", () => {
  it("creates a real PDF document", async () => {
    const buffer = await buildResumePdf(request);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(buffer.byteLength).toBeGreaterThan(1_000);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const content = (await extractText(pdf, { mergePages: true })).text;
    expect(content).toContain("Alex Morgan");
    expect(content).not.toContain("Tailored for");
    expect(content).not.toContain("Approved v1");
    expect(content).not.toContain("IR35Careers");
  });

  it("creates a real DOCX package", async () => {
    const buffer = await buildResumeDocx({ ...request, format: "docx" });
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(buffer.byteLength).toBeGreaterThan(2_000);
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    const footerXml = await zip.file("word/footer1.xml")?.async("string");
    const coreXml = await zip.file("docProps/core.xml")?.async("string");
    const exportedXml = `${documentXml ?? ""}\n${footerXml ?? ""}\n${coreXml ?? ""}`;
    expect(exportedXml).toContain("Alex Morgan");
    expect(exportedXml).not.toContain("Tailored for");
    expect(exportedXml).not.toContain("Approved v1");
    expect(exportedXml).not.toContain("IR35Careers");
  });
});
