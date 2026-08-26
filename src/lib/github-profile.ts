import type { ContractorProfile } from "@/lib/workspace/types";

export interface GithubUserSnapshot {
  login: string;
  name: string | null;
  html_url: string;
  blog: string | null;
  location: string | null;
  bio: string | null;
  avatar_url: string;
  company: string | null;
  public_repos: number;
  followers: number;
}

export interface GithubRepositorySnapshot {
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  updated_at: string;
}

export interface GithubImportSummary {
  username: string;
  avatarUrl: string;
  profileUrl: string;
  company: string;
  publicRepos: number;
  followers: number;
  languages: string[];
  importedProjects: number;
  connectedAt: string;
  syncedAt: string;
}

function filled(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function canonicalUrl(value: string | null | undefined): string {
  const candidate = value?.trim() ?? "";
  if (!candidate) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase("en-GB");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectedRepositories(repositories: GithubRepositorySnapshot[]): GithubRepositorySnapshot[] {
  return repositories
    .filter((repository) => !repository.fork && !repository.archived && filled(repository.description))
    .sort((left, right) => {
      const starDifference = right.stargazers_count - left.stargazers_count;
      if (starDifference !== 0) return starDifference;
      return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    })
    .slice(0, 4);
}

export function mergeGithubProfile(
  current: Partial<ContractorProfile>,
  githubUser: GithubUserSnapshot,
  repositories: GithubRepositorySnapshot[],
  now = new Date().toISOString(),
): { profile: Partial<ContractorProfile>; updatedFields: string[]; summary: GithubImportSummary } {
  const updatedFields: string[] = [];
  const languages = unique(
    repositories
      .filter((repository) => !repository.fork && !repository.archived)
      .map((repository) => repository.language ?? "")
      .filter(Boolean),
  ).slice(0, 8);
  const projects = selectedRepositories(repositories);
  const next: Partial<ContractorProfile> = { ...current };

  const fill = (key: keyof ContractorProfile, value: string, label: string) => {
    if (!value || filled(String(current[key] ?? ""))) return;
    (next as Record<string, unknown>)[key] = value;
    updatedFields.push(label);
  };

  fill("fullName", githubUser.name?.trim() ?? "", "name");
  fill("location", githubUser.location?.trim() ?? "", "location");
  fill("professionalSummary", githubUser.bio?.trim() ?? "", "professional summary");
  fill("portfolioUrl", canonicalUrl(githubUser.blog), "portfolio");

  if (next.githubUrl !== githubUser.html_url) updatedFields.push("GitHub profile");
  next.githubUrl = githubUser.html_url;

  const existingSkills = Array.isArray(current.skills) ? current.skills : [];
  const mergedSkills = unique([...existingSkills, ...languages]);
  if (mergedSkills.length > existingSkills.length) updatedFields.push("skills");
  next.skills = mergedSkills;

  if (!filled(current.projectsText) && projects.length > 0) {
    next.projectsText = projects
      .map((repository) => `${repository.name}: ${repository.description} (${repository.html_url})`)
      .join("\n");
    updatedFields.push("public projects");
  }

  const previousConnection = current.githubProfile;
  const connectedAt = previousConnection?.connectedAt ?? now;
  const summary: GithubImportSummary = {
    username: githubUser.login,
    avatarUrl: githubUser.avatar_url,
    profileUrl: githubUser.html_url,
    company: githubUser.company?.trim() ?? "",
    publicRepos: githubUser.public_repos,
    followers: githubUser.followers,
    languages,
    importedProjects: projects.length,
    connectedAt,
    syncedAt: now,
  };
  next.githubProfile = summary;

  return { profile: next, updatedFields: unique(updatedFields), summary };
}
