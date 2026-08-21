"use client";

/**
 * /onboarding — runs immediately after first sign-in.
 * Three quick steps on one page: name → CV upload → skills & preferences.
 * Saving lands the user on their personalized dashboard. Skippable, but the
 * dashboard nudges until the profile has skills.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowLeft, FileText, Loader2, UploadCloud, CheckCircle2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AppNav } from "@/components/AppNav";
import { useContractorPortalBoundary } from "@/components/useContractorPortalBoundary";
import {
  PROFILE_SKILL_OPTIONS,
  deleteCv,
  getProfile,
  upsertProfile,
  uploadCv,
  validateCvFile,
  validateCvFileContents,
} from "@/lib/profile";

const RATE_CHOICES = [0, 300, 400, 500, 600, 700, 800];
const DISCOVERY_SOURCES = [
  { id: "instagram", label: "Instagram" },
  { id: "tiktok", label: "TikTok" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "google", label: "Google Search" },
  { id: "ai", label: "AI assistant" },
  { id: "referral", label: "Friend or referral" },
  { id: "university", label: "University or careers service" },
  { id: "other", label: "Other" },
] as const;

export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const administratorRedirect = useContractorPortalBoundary(user?.email, loading);

  const [fullName, setFullName] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [existingCv, setExistingCv] = useState<string | null>(null);
  const [existingCvPath, setExistingCvPath] = useState<string | null>(null);
  const [checkingCv, setCheckingCv] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [targetRate, setTargetRate] = useState(0);
  const [ir35, setIr35] = useState<"outside" | "inside" | "either">("either");
  const [remote, setRemote] = useState<"remote" | "hybrid" | "onsite" | "any">("any");
  const [jobTitle, setJobTitle] = useState("");
  const [yearsExp, setYearsExp] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [discoverySource, setDiscoverySource] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!administratorRedirect && !loading && !user) router.replace("/account?next=/onboarding");
  }, [administratorRedirect, user, loading, router]);

  // Prefill from an existing profile (returning users editing their setup).
  useEffect(() => {
    if (!user || administratorRedirect) return;
    setDiscoverySource(typeof user.user_metadata?.discovery_source === "string" ? user.user_metadata.discovery_source : "");
    getProfile(user.id).then((profile) => {
      if (!profile) return;
      setFullName(profile.full_name ?? "");
      setSkills(profile.skills ?? []);
      setTargetRate(profile.target_rate_min ?? 0);
      setIr35(profile.preferred_ir35 ?? "either");
      setRemote(profile.preferred_remote ?? "any");
      setExistingCv(profile.cv_filename);
      setExistingCvPath(profile.cv_path);
      setJobTitle(profile.job_title ?? "");
      setYearsExp(profile.years_experience != null ? String(profile.years_experience) : "");
      setPhone(profile.phone ?? "");
      setLinkedin(profile.linkedin_url ?? "");
    });
  }, [administratorRedirect, user]);

  const toggleSkill = (skill: string) => {
    setSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : prev.length < 12 ? [...prev, skill] : prev
    );
  };

  const onPickFile = async (file: File | null) => {
    setError(null);
    if (!file) return;
    setCvFile(null);
    const invalid = validateCvFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setCheckingCv(true);
    try {
      const contentError = await validateCvFileContents(file);
      if (contentError) {
        setError(contentError);
        setCvFile(null);
        return;
      }
      setCvFile(file);
    } finally {
      setCheckingCv(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setError(null);

    if (!fullName.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (skills.length === 0) {
      setError("Pick at least one skill so we can match you to contracts.");
      return;
    }

    setSaving(true);

    let cv_path: string | undefined;
    let cv_filename: string | undefined;
    if (cvFile) {
      const uploaded = await uploadCv(user.id, cvFile);
      if (uploaded.error) {
        setError(`CV upload failed: ${uploaded.error}`);
        setSaving(false);
        return;
      }
      cv_path = uploaded.path ?? undefined;
      cv_filename = cvFile.name;
    }

    const saveError = await upsertProfile(user.id, {
      full_name: fullName.trim(),
      skills,
      target_rate_min: targetRate > 0 ? targetRate : null,
      preferred_ir35: ir35,
      preferred_remote: remote,
      job_title: jobTitle.trim() || null,
      years_experience: yearsExp ? parseInt(yearsExp, 10) : null,
      phone: phone.trim() || null,
      linkedin_url: linkedin.trim() || null,
      ...(cv_path ? { cv_path, cv_filename } : {}),
    });

    if (saveError) {
      if (cv_path) await deleteCv(user.id, cv_path);
      setError(saveError);
      setSaving(false);
      return;
    }
    if (cv_path && existingCvPath && existingCvPath !== cv_path) {
      await deleteCv(user.id, existingCvPath);
    }
    if (discoverySource) {
      const { getSupabase } = await import("@/lib/supabase");
      const { error: metadataError } = await getSupabase().auth.updateUser({ data: { discovery_source: discoverySource } });
      if (metadataError) {
        setError("Your profile was saved, but the discovery preference could not be saved. You can continue to the dashboard.");
        setSaving(false);
        return;
      }
    }
    router.replace("/dashboard");
  };

  if (administratorRedirect || loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:pl-[248px]">
      <AppNav />
    <main className="relative overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute -top-40 right-[-10%] h-[440px] w-[440px] rounded-full bg-green-200/50 blur-[120px]" />
        <div className="absolute bottom-[-15%] left-[-10%] h-[440px] w-[440px] rounded-full bg-green-200/50 blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
        <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800">
          <ArrowLeft size={14} /> Back to dashboard
        </Link>
        <div className="grid gap-10 lg:grid-cols-[300px_1fr]">
          {/* Sidebar: why we ask */}
          <aside className="lg:border-r lg:border-slate-200/70 lg:pr-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-green-700">
              Getting started
            </p>
            <h1 className="mt-2 text-2xl font-light tracking-tight sm:text-3xl">
              Let&apos;s get you matched
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Two minutes now, and personalised contract matches with real match
              scores immediately after.
            </p>
            <ul className="mt-6 space-y-4 text-sm text-slate-500">
              <li className="flex gap-2.5">
                <span className="mt-0.5 text-green-700">✓</span>
                Your CV is stored privately. Only you can ever access it.
              </li>
              <li className="flex gap-2.5">
                <span className="mt-0.5 text-green-700">✓</span>
                Skills power your match scores against every live contract.
              </li>
              <li className="flex gap-2.5">
                <span className="mt-0.5 text-green-700">✓</span>
                Preferences filter out roles you&apos;d never take.
              </li>
              <li className="flex gap-2.5">
                <span className="mt-0.5 text-green-700">✓</span>
                Edit any of this anytime from your dashboard.
              </li>
            </ul>
          </aside>

          {/* Content column */}
          <div>

        {/* Step 1: name */}
        <section>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-800">
            Your name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your full name"
            className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
          />
        </section>

        {/* Professional details */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="jobTitle" className="mb-1.5 block text-sm font-medium text-slate-800">
              Current role / title
            </label>
            <input
              id="jobTitle"
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. DevOps Engineer"
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
            />
          </div>
          <div>
            <label htmlFor="yearsExp" className="mb-1.5 block text-sm font-medium text-slate-800">
              Years of experience
            </label>
            <select
              id="yearsExp"
              value={yearsExp}
              onChange={(e) => setYearsExp(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-3 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
            >
              <option value="">Select…</option>
              <option value="1">0-2 years</option>
              <option value="3">3-5 years</option>
              <option value="6">6-9 years</option>
              <option value="10">10-15 years</option>
              <option value="16">15+ years</option>
            </select>
          </div>
          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-800">
              Phone <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+44 …"
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
            />
          </div>
          <div>
            <label htmlFor="linkedin" className="mb-1.5 block text-sm font-medium text-slate-800">
              LinkedIn <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="linkedin"
              type="url"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="https://linkedin.com/in/…"
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
            />
          </div>
        </section>

        {/* Step 2: CV */}
        <section className="mt-7">
          <p className="mb-1.5 text-sm font-medium text-slate-800">Your CV</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = "";
              void onPickFile(file);
            }}
          />
          {cvFile ? (
            <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <span className="flex min-w-0 items-center gap-2 text-sm text-slate-800">
                <FileText size={16} className="shrink-0 text-green-700" />
                <span className="truncate">{cvFile.name}</span>
              </span>
              <button
                onClick={() => setCvFile(null)}
                aria-label="Remove selected CV"
                className="text-slate-500 transition-colors hover:text-slate-900"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={checkingCv}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-wait disabled:opacity-60"
            >
              {checkingCv ? <Loader2 className="animate-spin" size={22} /> : <UploadCloud size={22} />}
              <span className="text-sm">
                {checkingCv ? "Checking the file before upload…" : existingCv ? (
                  <>
                    <span className="text-green-700">{existingCv}</span> on file. Upload a new
                    one to replace it
                  </>
                ) : (
                  "Upload your CV. PDF or DOCX, up to 5MB"
                )}
              </span>
            </button>
          )}
          <p className="mt-1.5 text-xs text-slate-500">
            Signature and active-content checks run before private storage. Replacement cleanup starts only after the new profile reference saves successfully.
          </p>
        </section>

        {/* Step 3: skills */}
        <section className="mt-7">
          <p className="mb-1.5 text-sm font-medium text-slate-800">
            Your skills <span className="text-slate-400">(pick up to 12)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_SKILL_OPTIONS.map((skill) => {
              const active = skills.includes(skill);
              return (
                <button
                  key={skill}
                  onClick={() => toggleSkill(skill)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                    active
                      ? "border-green-300 bg-green-100 text-green-700"
                      : "border-slate-300 bg-slate-50 text-slate-600 hover:border-slate-400 hover:text-slate-900"
                  }`}
                >
                  {skill}
                </button>
              );
            })}
          </div>
        </section>

        {/* Preferences */}
        <section className="mt-7 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="rate" className="mb-1.5 block text-sm font-medium text-slate-800">
              Minimum day rate
            </label>
            <select
              id="rate"
              value={targetRate}
              onChange={(e) => setTargetRate(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50 [&>option]:bg-white"
            >
              {RATE_CHOICES.map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? "No minimum" : `£${r}+/day`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ir35" className="mb-1.5 block text-sm font-medium text-slate-800">
              IR35 preference
            </label>
            <select
              id="ir35"
              value={ir35}
              onChange={(e) => setIr35(e.target.value as typeof ir35)}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50 [&>option]:bg-white"
            >
              <option value="either">Inside or Outside</option>
              <option value="outside">Outside IR35 only</option>
              <option value="inside">Inside IR35 only</option>
            </select>
          </div>
          <div>
            <label htmlFor="remote" className="mb-1.5 block text-sm font-medium text-slate-800">
              Workplace
            </label>
            <select
              id="remote"
              value={remote}
              onChange={(e) => setRemote(e.target.value as typeof remote)}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50 [&>option]:bg-white"
            >
              <option value="any">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </div>
        </section>

        <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold text-slate-900">How did you hear about IR35Careers?</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Optional. This helps us understand which contractor communities we should support.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {DISCOVERY_SOURCES.map((source) => (
              <label key={source.id} className={`ir35-focus flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-medium ${discoverySource === source.id ? "border-brand-500 bg-brand-50 text-brand-900" : "border-slate-200 text-slate-700 hover:border-slate-300"}`}>
                <input type="radio" name="discovery-source" value={source.id} checked={discoverySource === source.id} onChange={() => setDiscoverySource(source.id)} className="h-4 w-4 accent-brand-700" />
                {source.label}
              </label>
            ))}
          </div>
        </section>

        {error && (
          <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-7 flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving || checkingCv}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-green-400 to-green-400 px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            {saving || checkingCv ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                See my matches <ArrowRight size={15} />
              </>
            )}
          </button>
          <Link href="/dashboard" className="text-sm text-slate-500 underline-offset-4 hover:text-slate-600 hover:underline">
            Skip for now
          </Link>
        </div>

        {existingCv && !cvFile && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
            <CheckCircle2 size={13} className="text-green-700" /> CV on file: {existingCv}
          </p>
        )}
          </div>
        </div>
      </div>
    </main>
    </div>
  );
}
