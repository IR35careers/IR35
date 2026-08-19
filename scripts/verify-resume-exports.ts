import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildResumeDocx, buildResumePdf } from "../src/lib/resume/export";
import type { ResumeExportRequest } from "../src/lib/resume/types";

const outputDirectory = resolve("tmp/resume-export-qa");
const request: ResumeExportRequest = {
  format: "pdf",
  candidateName: "Alex Morgan",
  companyName: "Northstar Digital",
  jobTitle: "Senior DevOps Engineer - Outside IR35",
  versionLabel: "Approved role-tailored CV",
  resumeText: `Alex Morgan
alex.morgan@example.com | +44 7700 900123 | linkedin.com/in/alexmorgan

PROFILE
Contract technology specialist with experience improving cloud platforms and delivery workflows.
Role-relevant CV evidence: AWS, Terraform, DevOps and platform reliability.

TECHNICAL SKILLS
AWS | Terraform | Docker | Git | Agile | Kubernetes

PROFESSIONAL EXPERIENCE
Cloud Platform Consultant | UK Digital Programme | 2023 - Present
- Responsible for improving AWS platform reliability across production services.
- Worked on reusable Terraform components for engineering teams.
- Supported incident reviews and reduced recurring deployment failures by 28%.
- Partnered with delivery leads to document operational controls.

DevOps Engineer | Commerce Platform | 2020 - 2023
- Built automated delivery pipelines used by six product teams.
- Supported cloud cost reviews that identified 18% annual savings.

EDUCATION
BSc Computing

CERTIFICATIONS
Cloud practitioner certification`,
};

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const [pdf, docx] = await Promise.all([
    buildResumePdf(request),
    buildResumeDocx({ ...request, format: "docx" }),
  ]);
  await Promise.all([
    writeFile(resolve(outputDirectory, "alex-morgan-tailored-cv.pdf"), pdf),
    writeFile(resolve(outputDirectory, "alex-morgan-tailored-cv.docx"), docx),
  ]);
  process.stdout.write(`Created ${pdf.byteLength}-byte PDF and ${docx.byteLength}-byte DOCX in ${outputDirectory}\n`);
}

void main();
