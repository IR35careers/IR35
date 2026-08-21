"use client";

import { isSupabaseConfigured } from "@/lib/supabase-config";
import type { ResumeVersion, ResumeVersionStatus } from "@/lib/resume/types";

const LOCAL_STORAGE_KEY = "ir35careers.resume-versions.v1";
const LOCAL_LIMIT = 20;

interface ResumeVersionRow {
  id: string;
  user_id: string;
  job_id: string;
  job_title: string;
  company_name: string;
  source_filename: string;
  label: string;
  status: ResumeVersionStatus;
  source_text: string;
  tailored_text: string;
  accepted_suggestion_ids: string[];
  confirmed_keyword_ids: string[];
  score: ResumeVersion["score"];
  created_at: string;
  approved_at: string | null;
}

function readLocalVersions(): ResumeVersion[] {
  try {
    const value = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as ResumeVersion[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalVersions(versions: ResumeVersion[]): void {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(versions.slice(0, LOCAL_LIMIT)));
}

export function clearLocalResumeVersions(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(LOCAL_STORAGE_KEY);
}

function fromRow(row: ResumeVersionRow): ResumeVersion {
  return {
    id: row.id,
    userId: row.user_id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    companyName: row.company_name,
    sourceFilename: row.source_filename,
    label: row.label,
    status: row.status,
    sourceText: row.source_text,
    tailoredText: row.tailored_text,
    acceptedSuggestionIds: row.accepted_suggestion_ids ?? [],
    confirmedKeywordIds: row.confirmed_keyword_ids ?? [],
    score: row.score,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

function toRow(version: ResumeVersion, userId: string): ResumeVersionRow {
  return {
    id: version.id,
    user_id: userId,
    job_id: version.jobId,
    job_title: version.jobTitle,
    company_name: version.companyName,
    source_filename: version.sourceFilename,
    label: version.label,
    status: version.status,
    source_text: version.sourceText,
    tailored_text: version.tailoredText,
    accepted_suggestion_ids: version.acceptedSuggestionIds,
    confirmed_keyword_ids: version.confirmedKeywordIds,
    score: version.score,
    created_at: version.createdAt,
    approved_at: version.approvedAt,
  };
}

export function createResumeVersionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `resume-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function loadResumeVersions(jobId: string, userId: string | null): Promise<ResumeVersion[]> {
  if (isSupabaseConfigured()) {
    if (!userId) return [];
    const { getSupabase } = await import("@/lib/supabase");
    const { data, error } = await getSupabase()
      .from("resume_versions")
      .select("id, user_id, job_id, job_title, company_name, source_filename, label, status, source_text, tailored_text, accepted_suggestion_ids, confirmed_keyword_ids, score, created_at, approved_at")
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(LOCAL_LIMIT);
    if (error) throw new Error(error.message);
    return ((data ?? []) as ResumeVersionRow[]).map(fromRow);
  }

  return readLocalVersions()
    .filter((version) => version.jobId === jobId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function saveResumeVersion(version: ResumeVersion, userId: string | null): Promise<ResumeVersion> {
  if (isSupabaseConfigured()) {
    if (!userId) throw new Error("Sign in before saving a CV version.");
    const { getSupabase } = await import("@/lib/supabase");
    const { data, error } = await getSupabase()
      .from("resume_versions")
      .upsert(toRow({ ...version, userId }, userId))
      .select("id, user_id, job_id, job_title, company_name, source_filename, label, status, source_text, tailored_text, accepted_suggestion_ids, confirmed_keyword_ids, score, created_at, approved_at")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Version could not be saved.");
    return fromRow(data as ResumeVersionRow);
  }

  const versions = readLocalVersions();
  const saved = { ...version, userId: null };
  const next = [saved, ...versions.filter((item) => item.id !== version.id)];
  writeLocalVersions(next);
  return saved;
}

export async function deleteResumeVersion(id: string, userId: string | null): Promise<void> {
  if (isSupabaseConfigured()) {
    if (!userId) throw new Error("Sign in before deleting a CV version.");
    const { getSupabase } = await import("@/lib/supabase");
    const { error } = await getSupabase().from("resume_versions").delete().eq("id", id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return;
  }
  writeLocalVersions(readLocalVersions().filter((version) => version.id !== id));
}
