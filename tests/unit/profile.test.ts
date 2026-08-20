import { describe, expect, it } from "vitest";
import type { JobListing } from "@/lib/job-types";
import { scoreJob, type Profile } from "@/lib/profile";

const job: JobListing = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Platform Contractor",
  company_name: "Example Client",
  location: "London",
  remote_type: "hybrid",
  ir35_status: "outside",
  ir35_confidence: "medium",
  rate_min: 600,
  rate_max: 650,
  rate_currency: "GBP",
  rate_type: "daily",
  skills: ["aws", "Terraform"],
  posted_at: "2026-08-20T00:00:00.000Z",
  first_seen_at: "2026-08-20T00:00:00.000Z",
};

const profile: Profile = {
  id: "profile-1",
  full_name: "Alex Morgan",
  target_rate_min: 600,
  preferred_ir35: "outside",
  preferred_remote: "hybrid",
  skills: ["AWS", "Terraform", "Kubernetes"],
  cv_path: null,
  cv_filename: null,
  phone: null,
  linkedin_url: null,
  job_title: "Platform Engineer",
  years_experience: 8,
};

describe("profile-to-job scoring", () => {
  it("returns a transparent weighted breakdown and matches skills case-insensitively", () => {
    const result = scoreJob(job, profile);
    expect(result?.matchedSkills).toEqual(["AWS", "Terraform"]);
    expect(result?.unmatchedSkills).toEqual(["Kubernetes"]);
    expect(result?.factors.map((factor) => factor.weight)).toEqual([55, 20, 15, 10]);
    expect(result?.factors.reduce((sum, factor) => sum + factor.points, 0)).toBeCloseTo(result?.score ?? 0, 0);
    expect(result?.factors.find((factor) => factor.id === "rate")?.explanation).toMatch(/meets your £600\/day minimum/);
  });

  it("withholds a score when no profile skill appears in the listing", () => {
    expect(scoreJob({ ...job, skills: ["Java"] }, profile)).toBeNull();
  });
});
