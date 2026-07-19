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
import { ArrowRight, FileText, Loader2, UploadCloud, CheckCircle2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  PROFILE_SKILL_OPTIONS,
  getProfile,
  upsertProfile,
  uploadCv,
  validateCvFile,
} from "@/lib/profile";

const RATE_CHOICES = [0, 300, 400, 500, 600, 700, 800];

export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [existingCv, setExistingCv] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [targetRate, setTargetRate] = useState(0);
  const [ir35, setIr35] = useState<"outside" | "inside" | "either">("either");
  const [remote, setRemote] = useState<"remote" | "hybrid" | "onsite" | "any">("any");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/account?next=/onboarding");
  }, [user, loading, router]);

  // Prefill from an existing profile (returning users editing their setup).
  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then((profile) => {
      if (!profile) return;
      setFullName(profile.full_name ?? "");
      setSkills(profile.skills ?? []);
      setTargetRate(profile.target_rate_min ?? 0);
      setIr35(profile.preferred_ir35 ?? "either");
      setRemote(profile.preferred_remote ?? "any");
      setExistingCv(profile.cv_filename);
    });
  }, [user]);

  const toggleSkill = (skill: string) => {
    setSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : prev.length < 12 ? [...prev, skill] : prev
    );
  };

  const onPickFile = (file: File | null) => {
    setError(null);
    if (!file) return;
    const invalid = validateCvFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setCvFile(file);
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
      ...(cv_path ? { cv_path, cv_filename } : {}),
    });

    if (saveError) {
      setError(saveError);
      setSaving(false);
      return;
    }
    router.replace("/dashboard");
  };

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white/50">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-black text-white">
      <div className="pointer-events-none fixed inset-0" aria-hidden>
        <div className="absolute -top-40 right-[-10%] h-[440px] w-[440px] rounded-full bg-emerald-500/[0.10] blur-[120px]" />
        <div className="absolute bottom-[-15%] left-[-10%] h-[440px] w-[440px] rounded-full bg-sky-500/[0.09] blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[300px_1fr]">
          {/* Sidebar: why we ask */}
          <aside className="lg:border-r lg:border-white/[0.07] lg:pr-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              Getting started
            </p>
            <h1 className="mt-2 text-2xl font-light tracking-tight sm:text-3xl">
              Let&apos;s get you matched
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-white/55">
              Two minutes now — personalised contract matches with real match
              scores immediately after.
            </p>
            <ul className="mt-6 space-y-4 text-sm text-white/55">
              <li className="flex gap-2.5">
                <span className="mt-0.5 text-emerald-300">✓</span>
                Your CV is stored privately — only you can ever access it.
              </li>
              <li className="flex gap-2.5">
                <span className="mt-0.5 text-emerald-300">✓</span>
                Skills power your match scores against every live contract.
              </li>
              <li className="flex gap-2.5">
                <span className="mt-0.5 text-emerald-300">✓</span>
                Preferences filter out roles you&apos;d never take.
              </li>
              <li className="flex gap-2.5">
                <span className="mt-0.5 text-emerald-300">✓</span>
                Edit any of this anytime from your dashboard.
              </li>
            </ul>
          </aside>

          {/* Content column */}
          <div>

        {/* Step 1: name */}
        <section>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-white/80">
            Your name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Anvesh Mannuru"
            className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
          />
        </section>

        {/* Step 2: CV */}
        <section className="mt-7">
          <p className="mb-1.5 text-sm font-medium text-white/80">Your CV</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          {cvFile ? (
            <div className="flex items-center justify-between rounded-xl border border-emerald-400/30 bg-emerald-400/[0.08] px-4 py-3">
              <span className="flex min-w-0 items-center gap-2 text-sm text-white/85">
                <FileText size={16} className="shrink-0 text-emerald-300" />
                <span className="truncate">{cvFile.name}</span>
              </span>
              <button
                onClick={() => setCvFile(null)}
                aria-label="Remove selected CV"
                className="text-white/50 transition-colors hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.03] px-4 py-8 text-white/60 transition-colors hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <UploadCloud size={22} />
              <span className="text-sm">
                {existingCv ? (
                  <>
                    <span className="text-emerald-300">{existingCv}</span> on file — upload a new
                    one to replace it
                  </>
                ) : (
                  "Upload your CV — PDF or Word, up to 5MB"
                )}
              </span>
            </button>
          )}
          <p className="mt-1.5 text-xs text-white/40">
            Stored privately — only you can access it. AI CV reading arrives soon; for now, pick
            your skills below.
          </p>
        </section>

        {/* Step 3: skills */}
        <section className="mt-7">
          <p className="mb-1.5 text-sm font-medium text-white/80">
            Your skills <span className="text-white/40">(pick up to 12)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_SKILL_OPTIONS.map((skill) => {
              const active = skills.includes(skill);
              return (
                <button
                  key={skill}
                  onClick={() => toggleSkill(skill)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                    active
                      ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200"
                      : "border-white/15 bg-white/[0.05] text-white/60 hover:border-white/30 hover:text-white"
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
            <label htmlFor="rate" className="mb-1.5 block text-sm font-medium text-white/80">
              Minimum day rate
            </label>
            <select
              id="rate"
              value={targetRate}
              onChange={(e) => setTargetRate(Number(e.target.value))}
              className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2.5 text-sm text-white/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 [&>option]:bg-neutral-900"
            >
              {RATE_CHOICES.map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? "No minimum" : `£${r}+/day`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ir35" className="mb-1.5 block text-sm font-medium text-white/80">
              IR35 preference
            </label>
            <select
              id="ir35"
              value={ir35}
              onChange={(e) => setIr35(e.target.value as typeof ir35)}
              className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2.5 text-sm text-white/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 [&>option]:bg-neutral-900"
            >
              <option value="either">Inside or Outside</option>
              <option value="outside">Outside IR35 only</option>
              <option value="inside">Inside IR35 only</option>
            </select>
          </div>
          <div>
            <label htmlFor="remote" className="mb-1.5 block text-sm font-medium text-white/80">
              Workplace
            </label>
            <select
              id="remote"
              value={remote}
              onChange={(e) => setRemote(e.target.value as typeof remote)}
              className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2.5 text-sm text-white/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 [&>option]:bg-neutral-900"
            >
              <option value="any">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </div>
        </section>

        {error && (
          <p className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-7 flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-sky-400 px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                See my matches <ArrowRight size={15} />
              </>
            )}
          </button>
          <Link href="/dashboard" className="text-sm text-white/45 underline-offset-4 hover:text-white/70 hover:underline">
            Skip for now
          </Link>
        </div>

        {existingCv && !cvFile && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-white/45">
            <CheckCircle2 size={13} className="text-emerald-300" /> CV on file: {existingCv}
          </p>
        )}
          </div>
        </div>
      </div>
    </main>
  );
}
