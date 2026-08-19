import { describe, expect, it } from "vitest";
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
  });

  it("creates a real DOCX package", async () => {
    const buffer = await buildResumeDocx({ ...request, format: "docx" });
    expect(buffer.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(buffer.byteLength).toBeGreaterThan(2_000);
  });
});
