"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  Download,
  FileText,
  Github,
  IdCard,
  ListChecks,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type {
  ApplicationPreferences,
  ContractorProfile as ContractorProfileType,
  ResumeProfile,
} from "@/lib/workspace/types";
import { evaluateProfileReadiness } from "@/lib/workspace/profile-readiness";
import { extractSkills } from "@/lib/processing/skills-extractor";

type ProfileTab = "details" | "resume" | "cover" | "settings";

const DEFAULT_PREFERENCES: ApplicationPreferences = {
  resumeOptimisation: "honest",
  autoApproveSafeEdits: true,
  reviewBeforeSubmit: true,
  generateCoverLetter: true,
  usePrivateApplicationEmail: true,
};

const DEFAULT_RESUME_FORMAT: NonNullable<ResumeProfile["format"]> = {
  template: "Professional",
  font: "Arial",
  fontSize: 11,
  alignment: "left",
  compactSpacing: false,
  hiddenSections: [],
};

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-sm font-semibold text-slate-800">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-normal text-slate-900"
      />
    </label>
  );
}

function YesNoField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null | undefined;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <label className="text-sm font-semibold text-slate-800">
      {label}
      <select
        value={value === true ? "yes" : value === false ? "no" : ""}
        onChange={(event) =>
          onChange(
            event.target.value === "yes"
              ? true
              : event.target.value === "no"
                ? false
                : null,
          )
        }
        className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-normal text-slate-900"
      >
        <option value="">Choose an answer</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

function startingProfiles(
  profile: ContractorProfileType,
  fallbackResume: string,
  fallbackCover: string,
): ResumeProfile[] {
  if (profile.resumeProfiles?.length) return profile.resumeProfiles;
  return [
    {
      id: crypto.randomUUID(),
      name: profile.defaultCvLabel || "Primary CV",
      resumeText: fallbackResume,
      coverLetter: fallbackCover,
      isDefault: true,
    },
  ];
}

export function ContractorProfile() {
  const workspace = useWorkspaceState();
  const latestApplication = workspace.applications[0];
  const [profile, setProfile] = useState<ContractorProfileType>(() => {
    const resumeProfiles = startingProfiles(
      workspace.profile,
      latestApplication?.sourceCvText ?? "",
      latestApplication?.coverLetter ?? "",
    );
    return {
      ...workspace.profile,
      resumeProfiles,
      activeResumeProfileId:
        workspace.profile.activeResumeProfileId ?? resumeProfiles[0].id,
      applicationPreferences:
        workspace.profile.applicationPreferences ?? DEFAULT_PREFERENCES,
    };
  });
  const [tab, setTab] = useState<ProfileTab>("details");
  const [saved, setSaved] = useState(false);
  const [documentNotice, setDocumentNotice] = useState<string | null>(null);
  const resumeProfiles = profile.resumeProfiles ?? [];
  const activeProfile =
    resumeProfiles.find((item) => item.id === profile.activeResumeProfileId) ??
    resumeProfiles[0];
  const preferences = profile.applicationPreferences ?? DEFAULT_PREFERENCES;
  const resumeFormat = activeProfile?.format ?? DEFAULT_RESUME_FORMAT;
  const set = <K extends keyof ContractorProfileType>(
    key: K,
    value: ContractorProfileType[K],
  ) => {
    setSaved(false);
    setProfile((current) => ({ ...current, [key]: value }));
  };
  const setActiveProfile = (
    updater: (current: ResumeProfile) => ResumeProfile,
  ) =>
    set(
      "resumeProfiles",
      resumeProfiles.map((item) =>
        item.id === activeProfile?.id ? updater(item) : item,
      ),
    );
  const readiness = useMemo(
    () => evaluateProfileReadiness(profile, activeProfile?.resumeText ?? ""),
    [activeProfile?.resumeText, profile],
  );
  const save = () => {
    const savedProfile =
      readiness.complete && !profile.profileSetupCompletedAt
        ? { ...profile, profileSetupCompletedAt: new Date().toISOString() }
        : profile;
    setProfile(savedProfile);
    updateWorkspace((current) => ({
      ...current,
      profile: savedProfile,
      inbox: {
        ...current.inbox,
        forwardingEmail: savedProfile.forwardingEmail,
      },
    }));
    setSaved(true);
  };

  const completeness = readiness.percentage;
  const skills = profile.skills ?? [];
  const certifications = profile.certifications ?? [];
  const previewLines = useMemo(
    () => activeProfile?.resumeText.split(/\r?\n/) ?? [],
    [activeProfile?.resumeText],
  );
  const resumeSections = useMemo(
    () =>
      previewLines
        .filter((line) => /^[A-Z][A-Z &/+-]{2,}$/.test(line.trim()))
        .map((line) => line.trim()),
    [previewLines],
  );
  const setResumeFormat = (
    patch: Partial<NonNullable<ResumeProfile["format"]>>,
  ) =>
    setActiveProfile((current) => ({
      ...current,
      format: { ...DEFAULT_RESUME_FORMAT, ...current.format, ...patch },
    }));

  useEffect(() => {
    const applyHash = () => {
      const next = window.location.hash.replace("#", "");
      if (next === "apply-settings") setTab("settings");
      if (next === "resume") setTab("resume");
      if (next === "cover-letter") setTab("cover");
      if (next === "profile-details") setTab("details");
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const addResumeProfile = () => {
    const created: ResumeProfile = {
      id: crypto.randomUUID(),
      name: `Role profile ${resumeProfiles.length + 1}`,
      resumeText: activeProfile?.resumeText ?? "",
      coverLetter: activeProfile?.coverLetter ?? "",
      isDefault: false,
      format: activeProfile?.format ?? DEFAULT_RESUME_FORMAT,
    };
    set("resumeProfiles", [...resumeProfiles, created]);
    set("activeResumeProfileId", created.id);
  };

  const deleteResumeProfile = () => {
    if (!activeProfile || resumeProfiles.length === 1) return;
    const remaining = resumeProfiles.filter(
      (item) => item.id !== activeProfile.id,
    );
    set(
      "resumeProfiles",
      remaining.some((item) => item.isDefault)
        ? remaining
        : remaining.map((item, index) => ({ ...item, isDefault: index === 0 })),
    );
    set("activeResumeProfileId", remaining[0].id);
  };

  const makeDefault = () => {
    if (!activeProfile) return;
    set(
      "resumeProfiles",
      resumeProfiles.map((item) => ({
        ...item,
        isDefault: item.id === activeProfile.id,
      })),
    );
    set("defaultCvLabel", activeProfile.name);
  };

  const parseResume = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeProfile) return;
    setDocumentNotice("Reading your CV.");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/resume/parse", {
      method: "POST",
      body: form,
    });
    const payload = (await response.json()) as {
      text?: string;
      filename?: string;
      error?: string;
    };
    if (!response.ok || !payload.text) {
      setDocumentNotice(payload.error ?? "The CV could not be read.");
      return;
    }
    setActiveProfile((current) => ({
      ...current,
      name: payload.filename || current.name,
      resumeText: payload.text as string,
    }));
    const detectedSkills = extractSkills("", payload.text);
    if (detectedSkills.length > 0)
      set("skills", [
        ...new Set([...(profile.skills ?? []), ...detectedSkills]),
      ]);
    setDocumentNotice("CV replaced. Save your profile to keep this version.");
  };

  const downloadResume = async (format: "pdf" | "docx") => {
    if (!activeProfile?.resumeText.trim()) return;
    setDocumentNotice(`Preparing ${format.toUpperCase()} download.`);
    const response = await fetch("/api/resume/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format,
        resumeText: activeProfile.resumeText,
        candidateName: profile.fullName,
        jobTitle: profile.targetRole || "Contract role",
        companyName: "",
        versionLabel: activeProfile.name,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setDocumentNotice(payload.error ?? "The CV could not be downloaded.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.fullName || "Candidate"}-CV.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setDocumentNotice(`${format.toUpperCase()} downloaded.`);
  };

  const downloadCoverLetter = () => {
    if (!activeProfile?.coverLetter.trim()) return;
    const blob = new Blob([activeProfile.coverLetter], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.fullName || "Candidate"}-cover-letter.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <WorkspacePage
      eyebrow="Contractor profile"
      title="Your professional profile"
      description="Manage the facts, CV versions, cover letters and application preferences used for role preparation."
    >
      <section
        id="application-readiness"
        className={`scroll-mt-24 rounded-3xl border p-5 shadow-card sm:p-6 ${readiness.complete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${readiness.complete ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
            >
              {readiness.complete ? (
                <Check size={20} />
              ) : (
                <AlertCircle size={20} />
              )}
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-600">
                Application readiness
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">
                {readiness.complete
                  ? "Your reusable application profile is ready"
                  : `${readiness.missing.length} profile item${readiness.missing.length === 1 ? "" : "s"} left`}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
                Complete these answers once so employer forms can be filled
                consistently. New or sensitive questions will still be shown for
                your approval.
              </p>
            </div>
          </div>
          <div className="min-w-44">
            <div className="h-2 overflow-hidden rounded-full bg-white/80">
              <div
                className={`h-full rounded-full ${readiness.complete ? "bg-emerald-600" : "bg-amber-500"}`}
                style={{ width: `${readiness.percentage}%` }}
              />
            </div>
            <p className="mt-2 text-right text-sm font-bold text-slate-800">
              {readiness.percentage}% complete
            </p>
          </div>
        </div>
        {!readiness.complete && (
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {readiness.missing.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(
                    item.section === "cv"
                      ? "resume"
                      : item.section === "automation"
                        ? "settings"
                        : "details",
                  );
                  window.setTimeout(
                    () =>
                      document
                        .getElementById(
                          item.section === "cv"
                            ? "profile-resume"
                            : item.section === "automation"
                              ? "portal-automation"
                              : "reusable-answers",
                        )
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        }),
                    50,
                  );
                }}
                className="ir35-focus flex min-h-11 items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 text-left text-xs font-semibold text-slate-800"
              >
                <AlertCircle size={14} className="shrink-0 text-amber-600" />{" "}
                {item.label}
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 gap-3 overflow-x-auto pb-1">
            {resumeProfiles.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => set("activeResumeProfileId", item.id)}
                className={`ir35-focus inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold ${activeProfile?.id === item.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 text-slate-600"}`}
              >
                {item.isDefault && <Star size={14} fill="currentColor" />}
                {item.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addResumeProfile}
              disabled={resumeProfiles.length >= 5}
              className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              <Plus size={15} /> Add profile
            </button>
            <button
              type="button"
              onClick={makeDefault}
              disabled={activeProfile?.isDefault}
              className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              <Star size={15} /> Make default
            </button>
            <button
              type="button"
              onClick={deleteResumeProfile}
              disabled={resumeProfiles.length === 1}
              aria-label="Delete profile"
              className="ir35-focus flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 text-rose-700 disabled:opacity-30"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        {activeProfile && (
          <label className="mt-4 block text-xs font-semibold text-slate-600">
            Profile name
            <input
              value={activeProfile.name}
              onChange={(event) =>
                setActiveProfile((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              maxLength={80}
              className="ir35-focus mt-2 min-h-10 w-full max-w-md rounded-xl border border-slate-300 px-3 text-sm font-normal text-slate-900"
            />
          </label>
        )}
      </section>

      <nav
        className="mt-5 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1"
        aria-label="Profile sections"
      >
        {(
          [
            { id: "details", label: "Profile details" },
            { id: "resume", label: "Resume" },
            { id: "cover", label: "Cover letter" },
            { id: "settings", label: "Apply settings" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`ir35-focus min-h-10 shrink-0 rounded-xl px-5 text-sm font-semibold ${tab === item.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "details" && (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                  <UserRound size={20} />
                </span>
                <div>
                  <h2 className="font-semibold">
                    Identity and professional summary
                  </h2>
                  <p className="text-sm text-slate-600">
                    Shown only in materials and applications you approve.
                  </p>
                </div>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <Field
                  label="Full name"
                  value={profile.fullName}
                  onChange={(value) => set("fullName", value)}
                />
                <Field
                  label="Target role"
                  value={profile.targetRole ?? ""}
                  onChange={(value) => set("targetRole", value)}
                />
                <Field
                  label="Email"
                  type="email"
                  value={profile.email}
                  onChange={(value) => set("email", value)}
                />
                <Field
                  label="Phone"
                  value={profile.phone}
                  onChange={(value) => set("phone", value)}
                />
                <Field
                  label="Location"
                  value={profile.location}
                  onChange={(value) => set("location", value)}
                />
                <Field
                  label="LinkedIn URL"
                  type="url"
                  value={profile.linkedInUrl}
                  onChange={(value) => set("linkedInUrl", value)}
                />
                <Field
                  label="Portfolio URL"
                  type="url"
                  value={profile.portfolioUrl}
                  onChange={(value) => set("portfolioUrl", value)}
                />
                <Field
                  label="GitHub URL"
                  type="url"
                  value={profile.githubUrl ?? ""}
                  onChange={(value) => set("githubUrl", value)}
                />
              </div>
              <label className="mt-5 block text-sm font-semibold text-slate-800">
                Professional summary
                <textarea
                  value={profile.professionalSummary ?? ""}
                  onChange={(event) =>
                    set("professionalSummary", event.target.value)
                  }
                  rows={5}
                  className="ir35-focus mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 font-normal leading-6"
                />
              </label>
            </section>
            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card">
                <h2 className="font-semibold">Skills</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Separate skills with commas.
                </p>
                <textarea
                  value={skills.join(", ")}
                  onChange={(event) =>
                    set(
                      "skills",
                      event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                  rows={5}
                  className="ir35-focus mt-4 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card">
                <h2 className="font-semibold">Certifications</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Separate certifications with commas.
                </p>
                <textarea
                  value={certifications.join(", ")}
                  onChange={(event) =>
                    set(
                      "certifications",
                      event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                  rows={5}
                  className="ir35-focus mt-4 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {certifications.map((certification) => (
                    <span
                      key={certification}
                      className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800"
                    >
                      {certification}
                    </span>
                  ))}
                </div>
              </div>
            </section>
            <section
              id="portal-automation"
              className="scroll-mt-24 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-card sm:p-6"
            >
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-emerald-700" />
                <div>
                  <h2 className="font-semibold">Employer portal automation</h2>
                  <p className="text-sm text-slate-600">
                    Choose what IR35Careers may do after you approve an
                    application.
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-white p-4">
                  <span>
                    <strong className="block text-sm text-slate-950">
                      Create and sign in to employer accounts
                    </strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">
                      Use your assigned IR35Careers email and a protected
                      site-specific password.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={profile.portalAccountConsent === true}
                    onChange={(event) =>
                      set("portalAccountConsent", event.target.checked)
                    }
                    className="mt-1 h-5 w-5 accent-emerald-700"
                  />
                </label>
                <label className="flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-white p-4">
                  <span>
                    <strong className="block text-sm text-slate-950">
                      Use ordinary email verification codes
                    </strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">
                      Read a job-site code sent to your assigned inbox and use
                      it only for the matching application. CAPTCHA and identity
                      checks still require you.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={profile.automaticEmailVerification === true}
                    onChange={(event) =>
                      set("automaticEmailVerification", event.target.checked)
                    }
                    className="mt-1 h-5 w-5 accent-emerald-700"
                  />
                </label>
              </div>
            </section>
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
              <h2 className="font-semibold">Experience and projects</h2>
              <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <label className="text-sm font-semibold text-slate-800">
                  Experience summary
                  <textarea
                    value={profile.experienceText ?? ""}
                    onChange={(event) =>
                      set("experienceText", event.target.value)
                    }
                    rows={8}
                    className="ir35-focus mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 font-normal leading-6"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-800">
                  Projects
                  <textarea
                    value={profile.projectsText ?? ""}
                    onChange={(event) =>
                      set("projectsText", event.target.value)
                    }
                    rows={8}
                    className="ir35-focus mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 font-normal leading-6"
                  />
                </label>
              </div>
            </section>
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
              <div className="flex items-center gap-3">
                <IdCard className="text-blue-700" />
                <div>
                  <h2 className="font-semibold">
                    Work authorisation and availability
                  </h2>
                  <p className="text-sm text-slate-600">
                    These answers are never inferred.
                  </p>
                </div>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-800">
                  Right to work in the UK
                  <select
                    value={profile.rightToWork}
                    onChange={(event) =>
                      set(
                        "rightToWork",
                        event.target
                          .value as ContractorProfileType["rightToWork"],
                      )
                    }
                    className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-normal"
                  >
                    <option value="yes">Yes</option>
                    <option value="needs_sponsorship">
                      Requires sponsorship
                    </option>
                    <option value="no">No</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </select>
                </label>
                <Field
                  label="Availability"
                  value={profile.availability}
                  onChange={(value) => set("availability", value)}
                />
                <Field
                  label="Notice period"
                  value={profile.noticePeriod}
                  onChange={(value) => set("noticePeriod", value)}
                />
                <Field
                  label="Security clearance"
                  value={profile.clearance}
                  onChange={(value) => set("clearance", value)}
                />
              </div>
            </section>
            <section
              id="reusable-answers"
              className="scroll-mt-24 rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
            >
              <div className="flex items-center gap-3">
                <ListChecks className="text-emerald-700" />
                <div>
                  <h2 className="font-semibold">
                    Reusable application answers
                  </h2>
                  <p className="text-sm text-slate-600">
                    Complete common employer fields once.
                  </p>
                </div>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <Field
                  label="Address line 1"
                  value={profile.addressLine1 ?? ""}
                  onChange={(value) => set("addressLine1", value)}
                />
                <Field
                  label="Town or city"
                  value={profile.city ?? ""}
                  onChange={(value) => set("city", value)}
                />
                <Field
                  label="County or region"
                  value={profile.county ?? ""}
                  onChange={(value) => set("county", value)}
                />
                <Field
                  label="Postcode"
                  value={profile.postcode ?? ""}
                  onChange={(value) => set("postcode", value)}
                />
                <Field
                  label="Country"
                  value={profile.country ?? ""}
                  onChange={(value) => set("country", value)}
                />
                <YesNoField
                  label="Are you 18 or over?"
                  value={profile.isOver18}
                  onChange={(value) => set("isOver18", value)}
                />
                <YesNoField
                  label="Can you work in person?"
                  value={profile.canWorkInPerson}
                  onChange={(value) => set("canWorkInPerson", value)}
                />
                <YesNoField
                  label="Can you relocate?"
                  value={profile.canRelocate}
                  onChange={(value) => set("canRelocate", value)}
                />
                <YesNoField
                  label="Can you start immediately?"
                  value={profile.canStartImmediately}
                  onChange={(value) => set("canStartImmediately", value)}
                />
                <YesNoField
                  label="Do you have reliable transport?"
                  value={profile.hasTransportation}
                  onChange={(value) => set("hasTransportation", value)}
                />
                <YesNoField
                  label="Are you willing to travel for work?"
                  value={profile.willingToTravel}
                  onChange={(value) => set("willingToTravel", value)}
                />
                <YesNoField
                  label="Are you willing to work shifts?"
                  value={profile.willingToWorkShifts}
                  onChange={(value) => set("willingToWorkShifts", value)}
                />
                <YesNoField
                  label="Are you willing to work weekends?"
                  value={profile.willingToWorkWeekends}
                  onChange={(value) => set("willingToWorkWeekends", value)}
                />
                <YesNoField
                  label="Do you need a workplace accommodation?"
                  value={profile.needsAccommodation}
                  onChange={(value) => set("needsAccommodation", value)}
                />
                <YesNoField
                  label="Have you worked for this company before?"
                  value={profile.workedForCompanyBefore}
                  onChange={(value) => set("workedForCompanyBefore", value)}
                />
                <YesNoField
                  label="Do you hold government security clearance?"
                  value={profile.hasGovernmentClearance}
                  onChange={(value) => set("hasGovernmentClearance", value)}
                />
                <YesNoField
                  label="Do you have government ties to declare?"
                  value={profile.hasGovernmentTies}
                  onChange={(value) => set("hasGovernmentTies", value)}
                />
                <YesNoField
                  label="Can an employer run a standard background check?"
                  value={profile.backgroundCheckConsent}
                  onChange={(value) => set("backgroundCheckConsent", value)}
                />
                <YesNoField
                  label="Do you have convictions that must be declared for the role?"
                  value={profile.criminalConvictionsToDeclare}
                  onChange={(value) =>
                    set("criminalConvictionsToDeclare", value)
                  }
                />
                <Field
                  label="Target contract day rate"
                  value={profile.targetDayRate ?? ""}
                  onChange={(value) => set("targetDayRate", value)}
                  placeholder="For example, £650"
                />
                <Field
                  label="Target annual salary"
                  value={profile.targetAnnualSalary ?? ""}
                  onChange={(value) => set("targetAnnualSalary", value)}
                  placeholder="For example, £85,000"
                />
                <Field
                  label="Years of relevant experience"
                  value={profile.yearsOfExperience ?? ""}
                  onChange={(value) => set("yearsOfExperience", value)}
                />
                <Field
                  label="How did you hear about this opportunity?"
                  value={profile.referralSource ?? ""}
                  onChange={(value) => set("referralSource", value)}
                />
                <Field
                  label="Education institution"
                  value={profile.educationInstitution ?? ""}
                  onChange={(value) => set("educationInstitution", value)}
                />
                <Field
                  label="Qualification"
                  value={profile.educationQualification ?? ""}
                  onChange={(value) => set("educationQualification", value)}
                />
              </div>
            </section>
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
              <div className="flex items-center gap-3">
                <Building2 className="text-violet-700" />
                <h2 className="font-semibold">
                  Limited company and forwarding
                </h2>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <Field
                  label="Limited company name"
                  value={profile.limitedCompanyName}
                  onChange={(value) => set("limitedCompanyName", value)}
                />
                <Field
                  label="Companies House number"
                  value={profile.companyNumber}
                  onChange={(value) => set("companyNumber", value)}
                />
                <Field
                  label="Forward recruiter messages to"
                  type="email"
                  value={profile.forwardingEmail}
                  onChange={(value) => set("forwardingEmail", value)}
                />
                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={profile.vatRegistered}
                    onChange={(event) =>
                      set("vatRegistered", event.target.checked)
                    }
                    className="h-5 w-5 accent-emerald-700"
                  />{" "}
                  VAT registered
                </label>
              </div>
            </section>
          </div>
          <aside className="space-y-5 xl:sticky xl:top-24 xl:h-max">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-card">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 text-xl font-bold text-white">
                {profile.fullName.trim().charAt(0) || "C"}
              </div>
              <h2 className="mt-4 font-semibold text-slate-950">
                {profile.fullName || "Your profile"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {profile.targetRole || "UK contractor"}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-slate-500">
                {profile.location && <span>{profile.location}</span>}
                {profile.email && <span>{profile.email}</span>}
                {profile.githubUrl && (
                  <span className="inline-flex items-center gap-1">
                    <Github size={12} /> GitHub
                  </span>
                )}
              </div>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{ width: `${completeness}%` }}
                />
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-600">
                {completeness}% application details complete
              </p>
            </section>
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
              <ShieldCheck className="text-emerald-700" />
              <h2 className="mt-3 font-semibold text-emerald-950">
                Truth-first profile
              </h2>
              <p className="mt-1 text-sm leading-6 text-emerald-900">
                New legal, identity or personal questions pause for your answer
                instead of being guessed.
              </p>
            </section>
          </aside>
        </div>
      )}

      {tab === "resume" && activeProfile && (
        <div
          id="profile-resume"
          className="mt-6 scroll-mt-24 grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]"
        >
          <section className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-card">
            <div className="flex items-center gap-3">
              <FileText className="text-brand-700" />
              <div>
                <h2 className="font-semibold">Resume studio</h2>
                <p className="text-xs text-slate-500">
                  Edit, format and export the active CV version.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="ir35-focus inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-bold">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(event) => void parseResume(event)}
                  className="sr-only"
                />
                <Upload size={14} /> Replace
              </label>
              <button
                type="button"
                onClick={() => void downloadResume("pdf")}
                className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-bold"
              >
                <Download size={14} /> PDF
              </button>
              <button
                type="button"
                onClick={() => void downloadResume("docx")}
                className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-bold"
              >
                <Download size={14} /> DOCX
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold">
                Template
                <select
                  value={resumeFormat.template}
                  onChange={(event) =>
                    setResumeFormat({
                      template: event.target.value as NonNullable<
                        ResumeProfile["format"]
                      >["template"],
                    })
                  }
                  className="ir35-focus mt-2 min-h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                >
                  <option>Professional</option>
                  <option>Modern</option>
                  <option>Simple</option>
                </select>
              </label>
              <label className="text-xs font-semibold">
                Font
                <select
                  value={resumeFormat.font}
                  onChange={(event) =>
                    setResumeFormat({
                      font: event.target.value as NonNullable<
                        ResumeProfile["format"]
                      >["font"],
                    })
                  }
                  className="ir35-focus mt-2 min-h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal"
                >
                  <option>Arial</option>
                  <option>Calibri</option>
                  <option>Georgia</option>
                </select>
              </label>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <span className="text-xs font-semibold">Text size</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setResumeFormat({
                      fontSize: Math.max(9, resumeFormat.fontSize - 1),
                    })
                  }
                  className="h-8 w-8 rounded-lg border bg-white"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-bold">
                  {resumeFormat.fontSize}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setResumeFormat({
                      fontSize: Math.min(14, resumeFormat.fontSize + 1),
                    })
                  }
                  className="h-8 w-8 rounded-lg border bg-white"
                >
                  +
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setResumeFormat({ alignment: "left" })}
                className={`ir35-focus min-h-10 rounded-xl border text-xs font-bold ${resumeFormat.alignment === "left" ? "border-brand-500 bg-brand-50 text-brand-900" : "border-slate-300"}`}
              >
                Left align
              </button>
              <button
                type="button"
                onClick={() => setResumeFormat({ alignment: "justify" })}
                className={`ir35-focus min-h-10 rounded-xl border text-xs font-bold ${resumeFormat.alignment === "justify" ? "border-brand-500 bg-brand-50 text-brand-900" : "border-slate-300"}`}
              >
                Justify
              </button>
            </div>
            <label className="flex min-h-10 cursor-pointer items-center justify-between rounded-xl border border-slate-300 px-3 text-xs font-bold">
              Compact spacing
              <input
                type="checkbox"
                checked={resumeFormat.compactSpacing}
                onChange={(event) =>
                  setResumeFormat({ compactSpacing: event.target.checked })
                }
                className="h-4 w-4 accent-brand-700"
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setResumeFormat({ fontSize: 10, compactSpacing: true })
              }
              className="ir35-focus min-h-10 w-full rounded-xl border border-slate-300 text-xs font-bold"
            >
              Fit to one page
            </button>
            {resumeSections.length > 0 && (
              <details className="rounded-xl border border-slate-200 p-3">
                <summary className="cursor-pointer text-xs font-bold text-slate-800">
                  Sections
                </summary>
                <div className="mt-3 space-y-2">
                  {resumeSections.map((section) => (
                    <label
                      key={section}
                      className="flex cursor-pointer items-center justify-between gap-3 text-xs text-slate-600"
                    >
                      <span className="truncate">{section}</span>
                      <input
                        type="checkbox"
                        checked={!resumeFormat.hiddenSections.includes(section)}
                        onChange={(event) =>
                          setResumeFormat({
                            hiddenSections: event.target.checked
                              ? resumeFormat.hiddenSections.filter(
                                  (item) => item !== section,
                                )
                              : [...resumeFormat.hiddenSections, section],
                          })
                        }
                        className="h-4 w-4 accent-brand-700"
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}
            <label className="block text-xs font-semibold">
              Resume text
              <textarea
                value={activeProfile.resumeText}
                onChange={(event) =>
                  setActiveProfile((current) => ({
                    ...current,
                    resumeText: event.target.value,
                  }))
                }
                rows={20}
                className="ir35-focus mt-2 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-5"
              />
            </label>
            {documentNotice && (
              <p className="text-xs font-semibold text-brand-800" role="status">
                {documentNotice}
              </p>
            )}
          </section>
          <article className="min-h-[760px] rounded-3xl bg-slate-200 p-4 shadow-inner sm:p-8">
            <div
              className="mx-auto min-h-[700px] max-w-[780px] bg-white px-8 py-10 shadow-xl sm:px-14"
              style={{
                fontFamily: resumeFormat.font,
                fontSize: `${resumeFormat.fontSize}px`,
                textAlign: resumeFormat.alignment,
              }}
            >
              <header
                className={`border-b-2 pb-5 ${resumeFormat.template === "Modern" ? "border-blue-500" : resumeFormat.template === "Simple" ? "border-slate-300" : "border-emerald-600"}`}
              >
                <h2 className="text-3xl font-bold text-slate-950">
                  {profile.fullName || "Candidate name"}
                </h2>
                <p className="mt-2 text-slate-600">
                  {profile.targetRole || activeProfile.name}
                </p>
                <p className="mt-2 text-slate-500">
                  {[profile.email, profile.phone, profile.location]
                    .filter(Boolean)
                    .join(" | ")}
                </p>
              </header>
              <div
                className={`mt-6 leading-relaxed text-slate-700 ${resumeFormat.compactSpacing ? "space-y-1" : "space-y-2"}`}
              >
                {previewLines.length ? (
                  previewLines.reduce<{
                    nodes: React.ReactNode[];
                    hidden: boolean;
                  }>(
                    (result, line, index) => {
                      const trimmed = line.trim();
                      const heading = /^[A-Z][A-Z &/+-]{2,}$/.test(trimmed);
                      if (heading)
                        result.hidden =
                          resumeFormat.hiddenSections.includes(trimmed);
                      if (!result.hidden)
                        result.nodes.push(
                          trimmed ? (
                            <p
                              key={`${index}-${line.slice(0, 12)}`}
                              className={
                                heading
                                  ? "mt-5 font-bold uppercase tracking-wide text-slate-950"
                                  : "whitespace-pre-wrap"
                              }
                            >
                              {line}
                            </p>
                          ) : (
                            <div
                              key={`space-${index}`}
                              className={
                                resumeFormat.compactSpacing ? "h-1" : "h-2"
                              }
                            />
                          ),
                        );
                      return result;
                    },
                    { nodes: [], hidden: false },
                  ).nodes
                ) : (
                  <p className="text-slate-400">
                    Add your CV text to preview it here.
                  </p>
                )}
              </div>
            </div>
          </article>
        </div>
      )}

      {tab === "cover" && activeProfile && (
        <div className="mt-6 grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card">
            <div className="flex items-center gap-3">
              <Sparkles className="text-violet-700" />
              <div>
                <h2 className="font-semibold">Cover letter</h2>
                <p className="text-xs text-slate-500">
                  Keep a reusable base letter for this profile.
                </p>
              </div>
            </div>
            <label className="mt-5 block text-sm font-semibold">
              Letter text
              <textarea
                value={activeProfile.coverLetter}
                onChange={(event) =>
                  setActiveProfile((current) => ({
                    ...current,
                    coverLetter: event.target.value,
                  }))
                }
                rows={24}
                className="ir35-focus mt-2 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm leading-6"
              />
            </label>
            <button
              type="button"
              onClick={downloadCoverLetter}
              disabled={!activeProfile.coverLetter.trim()}
              className="ir35-focus mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold disabled:opacity-40"
            >
              <Download size={15} /> Download
            </button>
          </section>
          <article className="min-h-[720px] rounded-3xl bg-slate-200 p-4 sm:p-8">
            <div className="mx-auto min-h-[650px] max-w-[760px] bg-white px-8 py-12 shadow-xl sm:px-14">
              <h2 className="text-2xl font-bold text-slate-950">
                {profile.fullName || "Candidate name"}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {[profile.email, profile.phone, profile.location]
                  .filter(Boolean)
                  .join(" | ")}
              </p>
              <div className="mt-10 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                {activeProfile.coverLetter ||
                  "Add a base cover letter to preview it here."}
              </div>
              {activeProfile.coverLetter &&
                !activeProfile.coverLetter
                  .toLowerCase()
                  .includes(profile.fullName.toLowerCase()) && (
                  <div className="mt-8">
                    <p className="text-sm text-slate-700">Kind regards,</p>
                    <p className="mt-2 font-semibold">{profile.fullName}</p>
                  </div>
                )}
            </div>
          </article>
        </div>
      )}

      {tab === "settings" && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card lg:col-span-2">
            <h2 className="font-semibold">Resume optimisation</h2>
            <p className="mt-1 text-sm text-slate-600">
              Choose how role-specific wording is prepared from evidence already
              in your CV.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {(
                [
                  {
                    id: "off",
                    label: "Off",
                    help: "Keep the source CV unchanged.",
                  },
                  {
                    id: "honest",
                    label: "Honest",
                    help: "Apply safe evidence-based wording.",
                  },
                  {
                    id: "strong",
                    label: "Strong",
                    help: "Prioritise role language while preserving facts.",
                  },
                ] as const
              ).map((option) => (
                <label
                  key={option.id}
                  className={`cursor-pointer rounded-2xl border p-4 ${preferences.resumeOptimisation === option.id ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}
                >
                  <input
                    type="radio"
                    name="resume-optimisation"
                    checked={preferences.resumeOptimisation === option.id}
                    onChange={() =>
                      set("applicationPreferences", {
                        ...preferences,
                        resumeOptimisation: option.id,
                      })
                    }
                    className="h-5 w-5 accent-emerald-700"
                  />
                  <span className="mt-3 block text-sm font-bold text-slate-950">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">
                    {option.help}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-6 space-y-3">
              {(
                [
                  {
                    key: "autoApproveSafeEdits",
                    label: "Auto-approve safe CV edits",
                    help: "Apply truth-preserving changes during preparation.",
                  },
                  {
                    key: "reviewBeforeSubmit",
                    label: "Review before submit",
                    help: "Keep the final application approval step visible.",
                  },
                  {
                    key: "generateCoverLetter",
                    label: "Generate a cover letter",
                    help: "Prepare a role-specific letter when evidence is available.",
                  },
                  {
                    key: "usePrivateApplicationEmail",
                    label: "Use my private application email",
                    help: "Keep recruiter replies linked and forwarded to my account email.",
                  },
                ] as const
              ).map((option) => (
                <label
                  key={option.key}
                  className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4"
                >
                  <span>
                    <strong className="block text-sm text-slate-950">
                      {option.label}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-600">
                      {option.help}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences[option.key]}
                    onChange={(event) =>
                      set("applicationPreferences", {
                        ...preferences,
                        [option.key]: event.target.checked,
                      })
                    }
                    className="h-5 w-5 accent-emerald-700"
                  />
                </label>
              ))}
            </div>
          </section>
          <aside className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
            <ShieldCheck className="text-emerald-700" />
            <h2 className="mt-3 font-semibold text-emerald-950">
              Application control
            </h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900">
              IR35Careers never invents qualifications, experience or legal
              answers. A final employer submission always requires your explicit
              instruction.
            </p>
          </aside>
        </div>
      )}

      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={save}
          className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-6 text-sm font-bold text-white hover:bg-brand-800"
        >
          {saved ? <Check size={17} /> : <Save size={17} />}{" "}
          {saved ? "Profile saved" : "Save profile"}
        </button>
        {saved && (
          <p role="status" className="text-sm font-semibold text-emerald-700">
            All profile sections are saved.
          </p>
        )}
      </div>
    </WorkspacePage>
  );
}
