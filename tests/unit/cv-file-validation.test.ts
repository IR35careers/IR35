import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildResumeDocx } from "@/lib/resume/export";
import { validateCvFile, validateCvFileContents } from "@/lib/profile";

function file(name: string, type: string, body: Uint8Array | string): File {
  if (typeof body === "string") return new File([body], name, { type });
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return new File([copy.buffer], name, { type });
}

describe("private Resume upload validation", () => {
  it("rejects empty, legacy and unsupported files before reading them", () => {
    expect(validateCvFile(file("empty.pdf", "application/pdf", ""))).toBe("That Resume file is empty.");
    expect(validateCvFile(file("legacy.doc", "application/msword", "legacy"))).toMatch(/Older \.doc files/);
    expect(validateCvFile(file("photo.png", "image/png", "png"))).toBe("Please upload a PDF or DOCX document.");
  });

  it("rejects a spoofed or active PDF", async () => {
    await expect(validateCvFileContents(file("spoofed.pdf", "application/pdf", "not a pdf"))).resolves.toBe("That file is not a valid PDF.");
    await expect(validateCvFileContents(file("active.pdf", "application/pdf", "%PDF-1.7\n1 0 obj <</OpenAction 2 0 R>>"))).resolves.toMatch(/active or embedded content/);
  });

  it("accepts a clean generated DOCX", async () => {
    const bytes = await buildResumeDocx({
      format: "docx",
      candidateName: "Alex Morgan",
      companyName: "Example Ltd",
      jobTitle: "Platform Engineer",
      versionLabel: "Approved Resume",
      resumeText: "Alex Morgan\n\nPROFILE\nPlatform engineering contractor.\n\nEXPERIENCE\nBuilt reliable AWS services.",
    });
    await expect(validateCvFileContents(file("alex.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", new Uint8Array(bytes)))).resolves.toBeNull();
  });

  it("rejects embedded Word objects", async () => {
    const archive = new JSZip();
    archive.file("word/document.xml", "<w:document />");
    archive.file("word/embeddings/oleObject1.bin", "embedded content");
    const bytes = await archive.generateAsync({ type: "uint8array" });
    await expect(validateCvFileContents(file("embedded.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes))).resolves.toMatch(/macros or embedded objects/);
  });
});
