import { describe, expect, it } from "vitest";
import { mergeGithubProfile, type GithubRepositorySnapshot, type GithubUserSnapshot } from "@/lib/github-profile";

const user: GithubUserSnapshot = {
  login: "anvesh-dev",
  name: "Anvesh Mannuru",
  html_url: "https://github.com/anvesh-dev",
  blog: "anvesh.example.com",
  location: "London, UK",
  bio: "Platform engineer building reliable cloud services.",
  avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
  company: "Independent",
  public_repos: 14,
  followers: 31,
};

const repositories: GithubRepositorySnapshot[] = [
  {
    name: "contract-platform",
    html_url: "https://github.com/anvesh-dev/contract-platform",
    description: "A resilient TypeScript application platform.",
    language: "TypeScript",
    fork: false,
    archived: false,
    stargazers_count: 8,
    updated_at: "2026-08-25T10:00:00.000Z",
  },
  {
    name: "terraform-modules",
    html_url: "https://github.com/anvesh-dev/terraform-modules",
    description: "Reusable infrastructure modules.",
    language: "HCL",
    fork: false,
    archived: false,
    stargazers_count: 2,
    updated_at: "2026-08-24T10:00:00.000Z",
  },
];

describe("GitHub profile import", () => {
  it("fills missing professional details with public evidence", () => {
    const result = mergeGithubProfile({ skills: ["AWS"] }, user, repositories, "2026-08-26T09:00:00.000Z");

    expect(result.profile.fullName).toBe("Anvesh Mannuru");
    expect(result.profile.location).toBe("London, UK");
    expect(result.profile.portfolioUrl).toBe("https://anvesh.example.com/");
    expect(result.profile.githubUrl).toBe(user.html_url);
    expect(result.profile.skills).toEqual(["AWS", "TypeScript", "HCL"]);
    expect(result.profile.projectsText).toContain("contract-platform");
    expect(result.summary.languages).toEqual(["TypeScript", "HCL"]);
  });

  it("preserves profile information already approved by the contractor", () => {
    const result = mergeGithubProfile(
      {
        fullName: "Approved Name",
        location: "Manchester, UK",
        professionalSummary: "Approved resume summary",
        portfolioUrl: "https://approved.example.com",
        projectsText: "Approved project evidence",
        skills: ["TypeScript"],
      },
      user,
      repositories,
    );

    expect(result.profile.fullName).toBe("Approved Name");
    expect(result.profile.location).toBe("Manchester, UK");
    expect(result.profile.professionalSummary).toBe("Approved resume summary");
    expect(result.profile.portfolioUrl).toBe("https://approved.example.com");
    expect(result.profile.projectsText).toBe("Approved project evidence");
    expect(result.profile.skills).toEqual(["TypeScript", "HCL"]);
  });

  it("ignores forked and archived repositories when building evidence", () => {
    const excluded = repositories.map((repository, index) => ({
      ...repository,
      fork: index === 0,
      archived: index === 1,
    }));
    const result = mergeGithubProfile({}, user, excluded);

    expect(result.profile.projectsText).toBeUndefined();
    expect(result.profile.skills).toEqual([]);
    expect(result.summary.importedProjects).toBe(0);
  });
});
