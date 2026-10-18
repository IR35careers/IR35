import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/resume/export/route";

const cv = "Cloud Platforms\nAlex Morgan\nalex@example.com\n\nPROFILE\nAWS contractor delivering Terraform platforms.";
function request(body: unknown) {
  return new Request("http://localhost/api/resume/export", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("CV export identity boundary", () => {
  it("names the download after the validated person, not a rejected stored heading", async () => {
    const response = await POST(request({ format: "pdf", resumeText: cv, candidateName: "Cloud Platforms" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("Alex-Morgan-CV.pdf");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("honours an explicitly supplied personal name for the download", async () => {
    const response = await POST(request({ format: "docx", resumeText: cv, candidateName: "Priya Shah" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("Priya-Shah-CV.docx");
  });
  it("asks for a name instead of exporting a technical heading", async () => {
    const response = await POST(request({ format: "pdf", resumeText: "Cloud Platforms\nRBAC, IAM", candidateName: "Candidate" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/confirm your name/i);
  });
  it("retains bounded truncation of long nonidentity labels", async () => {
    const response = await POST(request({ format: "pdf", resumeText: cv, candidateName: "Alex Morgan",
      jobTitle: "Contract opportunity ".repeat(20), companyName: "Example ".repeat(30), versionLabel: "Reviewed ".repeat(20) }));
    expect(response.status).toBe(200);
  });
  it.each([
    { format: "pdf", resumeText: { unexpected: true } },
    { format: "pdf", resumeText: cv, candidateName: { unexpected: true } },
    { format: "exe", resumeText: cv },
  ])("rejects malformed export inputs before document creation: %o", async body => {
    expect((await POST(request(body))).status).toBe(400);
  });
});
