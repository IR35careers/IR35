import { describe, expect, it } from "vitest";
import { extractResumeProfile } from "@/lib/resume/profile-extraction";

const cv = `Priya Shah
Senior Data Engineer
priya.shah@example.com | +44 7700 900123 | Bristol, UK
linkedin.com/in/priya-shah-data | github.com/priyashah
10 High Street, Bristol, BS1 4ST

PROFESSIONAL SUMMARY
Senior data engineer with 8 years of experience building reliable cloud data platforms.

TECHNICAL SKILLS
Python, SQL, AWS, Airflow, dbt, Terraform and Docker

PROFESSIONAL EXPERIENCE
Senior Data Engineer | Example Consulting | 2021 to present
- Built Python and SQL pipelines on AWS using Airflow and dbt.

PROJECTS
Delivered a Terraform-based analytics platform.

CERTIFICATIONS
AWS Certified Data Engineer
Databricks Certified Data Engineer

EDUCATION
BSc Computer Science
University of Bristol`;

describe("Resume profile extraction", () => {
  it("extracts high-confidence personal and professional fields", () => {
    const result = extractResumeProfile(cv);

    expect(result.prefill).toMatchObject({
      fullName: "Priya Shah",
      targetRole: "Senior Data Engineer",
      email: "priya.shah@example.com",
      phone: "+44 7700 900123",
      location: "Bristol, UK",
      addressLine1: "10 High Street",
      city: "Bristol",
      postcode: "BS1 4ST",
      country: "United Kingdom",
      linkedInUrl: "https://linkedin.com/in/priya-shah-data",
      githubUrl: "https://github.com/priyashah",
      yearsOfExperience: "8",
      educationInstitution: "University of Bristol",
      educationQualification: "BSc Computer Science",
    });
    expect(result.prefill.professionalSummary).toContain("Senior data engineer");
    expect(result.prefill.experienceText).toContain("Example Consulting");
    expect(result.prefill.projectsText).toContain("Terraform-based analytics platform");
    expect(result.prefill.certifications).toEqual([
      "AWS Certified Data Engineer",
      "Databricks Certified Data Engineer",
    ]);
  });

  it("adds only evidenced skills and keeps related skills as suggestions", () => {
    const result = extractResumeProfile(cv);

    expect(result.detectedSkills).toEqual(
      expect.arrayContaining(["Python", "SQL", "AWS", "Airflow", "dbt", "Terraform", "Docker"]),
    );
    expect(result.suggestedSkills).toContain("Kubernetes");
    expect(result.detectedSkills).not.toContain("Kubernetes");
  });

  it("does not infer protected or eligibility answers", () => {
    const result = extractResumeProfile(`${cv}\nBritish citizen and over 18.`);
    expect(result.prefill).not.toHaveProperty("rightToWork");
    expect(result.prefill).not.toHaveProperty("isOver18");
  });
});
