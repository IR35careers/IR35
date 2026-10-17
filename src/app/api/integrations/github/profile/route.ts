import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requestUser } from "@/lib/request-user";
import {
  mergeGithubProfile,
  type GithubRepositorySnapshot,
  type GithubUserSnapshot,
} from "@/lib/github-profile";
import type { ContractorProfile } from "@/lib/workspace/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function githubHeaders(providerToken?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "IR35Careers-profile-importer",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(providerToken ? { Authorization: `Bearer ${providerToken}` } : {}),
  };
}

async function githubJson<T>(url: string, providerToken?: string): Promise<T> {
  const response = await fetch(url, {
    headers: githubHeaders(providerToken),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "GitHub access expired. Connect GitHub again." : "GitHub could not be reached. Try again shortly.");
  }
  return response.json() as Promise<T>;
}

function identityUsername(user: User): string {
  const github = user?.identities?.find((identity) => identity.provider === "github");
  const data = github?.identity_data as Record<string, unknown> | undefined;
  return String(data?.user_name ?? data?.preferred_username ?? data?.login ?? "").trim();
}

export async function POST(request: NextRequest) {
  const authenticated = await requestUser(request);
  if ("response" in authenticated) return authenticated.response;

  let providerToken = "";
  try {
    const body = (await request.json()) as { providerToken?: unknown };
    providerToken = typeof body.providerToken === "string" && body.providerToken.length <= 512
      ? body.providerToken.trim()
      : "";
  } catch {
    providerToken = "";
  }

  try {
    const username = identityUsername(authenticated.user);
    const githubUser = providerToken
      ? await githubJson<GithubUserSnapshot>("https://api.github.com/user", providerToken)
      : username
        ? await githubJson<GithubUserSnapshot>(`https://api.github.com/users/${encodeURIComponent(username)}`)
        : null;

    if (!githubUser?.login) {
      return NextResponse.json(
        { error: "Connect your GitHub account before importing your professional profile." },
        { status: 409, headers: NO_STORE },
      );
    }

    const repositoryUrl = providerToken
      ? "https://api.github.com/user/repos?visibility=public&affiliation=owner&sort=updated&per_page=100"
      : `https://api.github.com/users/${encodeURIComponent(githubUser.login)}/repos?type=owner&sort=updated&per_page=100`;
    const repositories = await githubJson<GithubRepositorySnapshot[]>(repositoryUrl, providerToken || undefined);
    const admin = getSupabaseAdmin();
    const existingResult = await admin
      .from("profiles")
      .select("application_profile")
      .eq("id", authenticated.user.id)
      .maybeSingle();
    if (existingResult.error) throw new Error(existingResult.error.message);

    const existing = existingResult.data?.application_profile && typeof existingResult.data.application_profile === "object"
      ? (existingResult.data.application_profile as Partial<ContractorProfile>)
      : ({ email: authenticated.user.email ?? "", forwardingEmail: authenticated.user.email ?? "" } as Partial<ContractorProfile>);
    const merged = mergeGithubProfile(existing, githubUser, repositories);
    const profile = {
      ...merged.profile,
      email: existing.email?.trim() || authenticated.user.email || "",
      forwardingEmail: existing.forwardingEmail?.trim() || authenticated.user.email || "",
    } as ContractorProfile;
    const activeResume = profile.resumeProfiles?.find((resume) => resume.id === profile.activeResumeProfileId)
      ?? profile.resumeProfiles?.find((resume) => resume.isDefault)
      ?? profile.resumeProfiles?.[0];
    const years = Number.parseInt(profile.yearsOfExperience ?? "", 10);
    const saveResult = await admin.from("profiles").upsert({
      id: authenticated.user.id,
      application_profile: profile,
      full_name: profile.fullName?.trim() || null,
      skills: profile.skills ?? [],
      phone: profile.phone?.trim() || null,
      linkedin_url: profile.linkedInUrl?.trim() || null,
      job_title: profile.targetRole?.trim() || null,
      years_experience: Number.isFinite(years) && years > 0 ? years : null,
      cv_filename: activeResume?.resumeText?.trim() ? activeResume.name : null,
      updated_at: new Date().toISOString(),
    });
    if (saveResult.error) throw new Error(saveResult.error.message);

    return NextResponse.json(
      { profile, updatedFields: merged.updatedFields, github: merged.summary },
      { headers: NO_STORE },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "GitHub profile import failed." },
      { status: 502, headers: NO_STORE },
    );
  }
}
