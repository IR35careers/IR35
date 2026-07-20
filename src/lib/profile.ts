/**
 * Profile helpers: load/save the user's profile, upload CVs to private
 * storage, time-aware greetings, and the match-scoring engine.
 *
 * Match scoring (no AI required — AI upgrades this later):
 *   55%  skill overlap  (matched profile skills / total profile skills)
 *   20%  rate fit       (job's known rate meets the user's target)
 *   15%  IR35 fit       (matches preference; 'either' always fits)
 *   10%  workplace fit  (matches preference; 'any' always fits)
 * Jobs with zero skill overlap are not shown as matches at all.
 */

import { supabase } from "@/lib/supabase";
import type { JobListing } from "@/lib/job-types";

export interface Profile {
  id: string;
  full_name: string;
  target_rate_min: number | null;
  preferred_ir35: "outside" | "inside" | "either";
  preferred_remote: "remote" | "hybrid" | "onsite" | "any";
  skills: string[];
  cv_path: string | null;
  cv_filename: string | null;
  phone: string | null;
  linkedin_url: string | null;
  job_title: string | null;
  years_experience: number | null;
}

/** Curated skill options for onboarding (canonical names match jobs.skills). */
export const PROFILE_SKILL_OPTIONS = [
  "React",
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Python",
  "Java",
  ".NET",
  "C#",
  "AWS",
  "Azure",
  "GCP",
  "DevOps",
  "Kubernetes",
  "Docker",
  "Terraform",
  "CI/CD",
  "SQL",
  "PostgreSQL",
  "Data Engineering",
  "Data Science",
  "Machine Learning",
  "Power BI",
  "Salesforce",
  "SAP",
  "Dynamics 365",
  "ServiceNow",
  "Cyber Security",
  "SC Cleared",
  "Business Analysis",
  "Project Management",
  "Product Management",
  "Solutions Architecture",
  "QA/Testing",
  "Agile",
] as const;

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, target_rate_min, preferred_ir35, preferred_remote, skills, cv_path, cv_filename, phone, linkedin_url, job_title, years_experience")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Profile;
}

export async function upsertProfile(
  userId: string,
  fields: Partial<Omit<Profile, "id">>
): Promise<string | null> {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...fields, updated_at: new Date().toISOString() });
  return error ? error.message : null;
}

const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function validateCvFile(file: File): string | null {
  if (file.size > CV_MAX_BYTES) return "CV must be under 5MB.";
  const okType = CV_TYPES.includes(file.type) || /\.(pdf|docx?)$/i.test(file.name);
  if (!okType) return "Please upload a PDF or Word document.";
  return null;
}

/** Upload a CV into the user's private folder; returns { path } or { error }. */
export async function uploadCv(
  userId: string,
  file: File
): Promise<{ path: string | null; error: string | null }> {
  const invalid = validateCvFile(file);
  if (invalid) return { path: null, error: invalid };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
  const path = `${userId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from("cvs").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) return { path: null, error: error.message };
  return { path, error: null };
}

/** "Good morning" / afternoon / evening / night-owl by local time. */
export function timeGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Burning the midnight oil";
}

export function firstName(profile: Profile | null, email: string | undefined): string {
  const name = profile?.full_name?.trim();
  if (name) return name.split(/\s+/)[0];
  return (email ?? "").split("@")[0] || "there";
}

export interface ScoredJob {
  job: JobListing;
  score: number;
  matchedSkills: string[];
}

export function scoreJob(job: JobListing, profile: Profile): ScoredJob | null {
  const profileSkills = profile.skills ?? [];
  if (profileSkills.length === 0) return null;

  const jobSkills = new Set(job.skills ?? []);
  const matchedSkills = profileSkills.filter((s) => jobSkills.has(s));
  if (matchedSkills.length === 0) return null;

  const skillScore = matchedSkills.length / profileSkills.length; // 0..1

  let rateScore = 0.5; // unknown rate: neutral
  if (profile.target_rate_min && (job.rate_max ?? job.rate_min) !== null) {
    const jobRate = (job.rate_max ?? job.rate_min) as number;
    rateScore =
      job.rate_type === "daily" || job.rate_type === "unknown"
        ? jobRate >= profile.target_rate_min
          ? 1
          : Math.max(0, jobRate / profile.target_rate_min)
        : 0.5;
  }

  const ir35Score =
    profile.preferred_ir35 === "either"
      ? 1
      : job.ir35_status === profile.preferred_ir35
        ? 1
        : job.ir35_status === "unknown"
          ? 0.5
          : 0;

  const remoteScore =
    profile.preferred_remote === "any"
      ? 1
      : job.remote_type === profile.preferred_remote
        ? 1
        : job.remote_type === "unknown"
          ? 0.5
          : 0.25;

  const score = Math.round(
    (skillScore * 0.55 + rateScore * 0.2 + ir35Score * 0.15 + remoteScore * 0.1) * 100
  );
  return { job, score, matchedSkills };
}

/** Fetch and score matching jobs for a profile. */
export async function fetchMatches(profile: Profile, limit = 12): Promise<ScoredJob[]> {
  if (!profile.skills || profile.skills.length === 0) return [];
  let query = supabase
    .from("jobs")
    .select(
      "id, title, company_name, location, remote_type, ir35_status, ir35_confidence, rate_min, rate_max, rate_currency, rate_type, skills, posted_at, first_seen_at"
    )
    .is("expired_at", null)
    .overlaps("skills", profile.skills)
    .order("posted_on", { ascending: false, nullsFirst: false })
    .limit(60);

  if (profile.preferred_ir35 !== "either") {
    // Soft preference: fetch all, scoring handles it — but bias the pool when
    // the user has a hard preference by excluding the opposite status.
    const opposite = profile.preferred_ir35 === "outside" ? "inside" : "outside";
    query = query.neq("ir35_status", opposite);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as unknown as JobListing[])
    .map((job) => scoreJob(job, profile))
    .filter((s): s is ScoredJob => s !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Real profile completeness score (0..100) based on fields filled in. */
export function profileStrength(p: Profile | null): number {
  if (!p) return 0;
  let s = 0;
  if (p.full_name?.trim()) s += 15;
  if (p.cv_filename) s += 20;
  if ((p.skills?.length ?? 0) >= 1) s += 15;
  if ((p.skills?.length ?? 0) >= 5) s += 10;
  if (p.target_rate_min) s += 10;
  if (p.job_title?.trim()) s += 10;
  if (p.years_experience != null) s += 10;
  if (p.phone?.trim() || p.linkedin_url?.trim()) s += 10;
  return Math.min(100, s);
}
