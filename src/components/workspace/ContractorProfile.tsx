"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  ArrowRight,
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
  X,
} from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { useAuth } from "@/lib/auth-context";
import { saveCloudWorkspace } from "@/lib/workspace/repository";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type {
  ApplicationPreferences,
  ContractorProfile as ContractorProfileType,
  ResumeProfile,
} from "@/lib/workspace/types";
import { evaluateProfileReadiness } from "@/lib/workspace/profile-readiness";
import { extractSkills } from "@/lib/processing/skills-extractor";
import { extractResumeProfile, type ResumeProfileExtraction, type ResumeSkillSuggestion } from "@/lib/resume/profile-extraction";
import { normaliseResumeText } from "@/lib/resume/normalise-text";

type ProfileTab = "details" | "resume" | "cover" | "settings";
type ProfileDetailsSection = "identity" | "experience" | "answers" | "company";
type ProfileNavigationId = ProfileDetailsSection | Exclude<ProfileTab, "details">;

const PROFILE_NAVIGATION: Array<{ id: ProfileNavigationId; label: string }> = [
  { id: "identity", label: "About you" },
  { id: "experience", label: "Experience" },
  { id: "answers", label: "Application answers" },
  { id: "company", label: "Company" },
  { id: "resume", label: "Resume" },
  { id: "cover", label: "Cover letter" },
  { id: "settings", label: "Apply settings" },
];

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
      name: profile.defaultCvLabel || "Primary Resume",
      resumeText: fallbackResume,
      coverLetter: fallbackCover,
      isDefault: true,
    },
  ];
}

export function ContractorProfile({ returnTo }: { returnTo?: string }) {
  const { user } = useAuth();
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
  const [detailsSection, setDetailsSection] = useState<ProfileDetailsSection>("identity");
  const [resumeEditing, setResumeEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [documentNotice, setDocumentNotice] = useState<string | null>(null);
  const [customSkill, setCustomSkill] = useState("");
  const [cvDetectedSkills, setCvDetectedSkills] = useState<string[]>([]);
  const [suggestedSkills, setSuggestedSkills] = useState<string[]>([]);
  const [skillSuggestionDetails, setSkillSuggestionDetails] = useState<ResumeSkillSuggestion[]>([]);
  const [cvDetectedFields, setCvDetectedFields] = useState<string[]>([]);
  const activeNavigationId: ProfileNavigationId =
    tab === "details" ? detailsSection : tab;
  const selectProfileSection = (id: ProfileNavigationId) => {
    if (["identity", "experience", "answers", "company"].includes(id)) {
      setTab("details");
      setDetailsSection(id as ProfileDetailsSection);
      return;
    }
    setTab(id as Exclude<ProfileTab, "details">);
  };
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
  const persistProfile = async (candidate: ContractorProfileType) => {
    setSaving(true);
    setSaveError(null);
    const normalisedCandidate: ContractorProfileType = {
      ...candidate,
      resumeProfiles: candidate.resumeProfiles?.map((resumeProfile) => ({
        ...resumeProfile,
        resumeText: normaliseResumeText(resumeProfile.resumeText),
      })),
    };
    const candidateResume =
      normalisedCandidate.resumeProfiles?.find(
        (item) => item.id === normalisedCandidate.activeResumeProfileId,
      ) ?? normalisedCandidate.resumeProfiles?.[0];
    const candidateReadiness = evaluateProfileReadiness(
      normalisedCandidate,
      candidateResume?.resumeText ?? "",
    );
    const savedProfile =
      candidateReadiness.complete && !normalisedCandidate.profileSetupCompletedAt
        ? { ...normalisedCandidate, profileSetupCompletedAt: new Date().toISOString() }
        : normalisedCandidate;
    const nextWorkspace = {
      ...workspace,
      profile: savedProfile,
      inbox: {
        ...workspace.inbox,
        forwardingEmail: savedProfile.forwardingEmail,
      },
    };
    setProfile(savedProfile);
    updateWorkspace(() => nextWorkspace);
    try {
      if (user?.id) {
        await saveCloudWorkspace(user.id, nextWorkspace);
      }
      setSaved(true);
      return true;
    } catch (caught) {
      setSaveError(
        caught instanceof Error
          ? caught.message
          : "Your profile could not be saved. Please try again.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };
  const save = async () => persistProfile(profile);

  const completeness = readiness.percentage;
  const skills = profile.skills ?? [];
  const certifications = profile.certifications ?? [];
  const addSkill = (value: string) => {
    const skill = value.trim().replace(/\s+/g, " ");
    if (!skill) return;
    const exists = skills.some(
      (item) => item.toLocaleLowerCase("en-GB") === skill.toLocaleLowerCase("en-GB"),
    );
    if (!exists) set("skills", [...skills, skill]);
    setSuggestedSkills((current) =>
      current.filter(
        (item) => item.toLocaleLowerCase("en-GB") !== skill.toLocaleLowerCase("en-GB"),
      ),
    );
    setSkillSuggestionDetails((current) =>
      current.filter(
        (item) => item.skill.toLocaleLowerCase("en-GB") !== skill.toLocaleLowerCase("en-GB"),
      ),
    );
    setCustomSkill("");
  };
  const removeSkill = (value: string) =>
    set(
      "skills",
      skills.filter((skill) => skill !== value),
    );
  const activeResumeText = activeProfile?.resumeText ?? "";
  const previewLines = useMemo(() => {
    const previewText = normaliseResumeText(activeResumeText);
    return previewText ? previewText.split(/\r?\n/) : [];
  }, [activeResumeText]);
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

  useEffect(() => {
    const resumeText = activeProfile?.resumeText?.trim() ?? "";
    if (!resumeText) {
      setCvDetectedSkills([]);
      setSuggestedSkills([]);
      setSkillSuggestionDetails([]);
      return;
    }
    const extraction = extractResumeProfile(resumeText);
    const currentSkills = new Set(
      (profile.skills ?? []).map((skill) => skill.toLocaleLowerCase("en-GB")),
    );
    const availableSuggestions = extraction.skillSuggestions.filter(
      (suggestion) => !currentSkills.has(suggestion.skill.toLocaleLowerCase("en-GB")),
    );
    setCvDetectedSkills(extraction.detectedSkills);
    setSuggestedSkills(availableSuggestions.map((suggestion) => suggestion.skill));
    setSkillSuggestionDetails(availableSuggestions);
  }, [activeProfile?.id, activeProfile?.resumeText, profile.skills]);

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
    setDocumentNotice("Reading your resume.");
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
      extraction?: ResumeProfileExtraction;
    };
    if (!response.ok || !payload.text) {
      setDocumentNotice(payload.error ?? "The resume could not be read.");
      return;
    }
    const extraction = payload.extraction;
    const detectedSkills = extraction?.detectedSkills ?? extractSkills("", payload.text);
    const prefill = extraction?.prefill ?? {};
    const keepOrFill = (currentValue: string | undefined, nextValue: string | undefined) =>
      currentValue?.trim() ? currentValue : nextValue ?? currentValue ?? "";
    const keepBoolean = (currentValue: boolean | null | undefined, nextValue: boolean | undefined) =>
      currentValue === true || currentValue === false ? currentValue : nextValue ?? currentValue;
    const nextProfile: ContractorProfileType = {
      ...profile,
      fullName: keepOrFill(profile.fullName, prefill.fullName),
      email: keepOrFill(profile.email, prefill.email),
      phone: keepOrFill(profile.phone, prefill.phone),
      location: keepOrFill(profile.location, prefill.location),
      addressLine1: keepOrFill(profile.addressLine1, prefill.addressLine1),
      city: keepOrFill(profile.city, prefill.city),
      county: keepOrFill(profile.county, prefill.county),
      postcode: keepOrFill(profile.postcode, prefill.postcode),
      country: keepOrFill(profile.country, prefill.country),
      linkedInUrl: keepOrFill(profile.linkedInUrl, prefill.linkedInUrl),
      portfolioUrl: keepOrFill(profile.portfolioUrl, prefill.portfolioUrl),
      githubUrl: keepOrFill(profile.githubUrl, prefill.githubUrl),
      professionalSummary: keepOrFill(profile.professionalSummary, prefill.professionalSummary),
      targetRole: keepOrFill(profile.targetRole, prefill.targetRole),
      yearsOfExperience: keepOrFill(profile.yearsOfExperience, prefill.yearsOfExperience),
      availability: keepOrFill(profile.availability, prefill.availability),
      noticePeriod: keepOrFill(profile.noticePeriod, prefill.noticePeriod),
      clearance: keepOrFill(profile.clearance, prefill.clearance),
      rightToWork:
        profile.rightToWork === "prefer_not_to_say" && prefill.rightToWork
          ? prefill.rightToWork
          : profile.rightToWork,
      hasGovernmentClearance: keepBoolean(profile.hasGovernmentClearance, prefill.hasGovernmentClearance),
      canWorkInPerson: keepBoolean(profile.canWorkInPerson, prefill.canWorkInPerson),
      canRelocate: keepBoolean(profile.canRelocate, prefill.canRelocate),
      canStartImmediately: keepBoolean(profile.canStartImmediately, prefill.canStartImmediately),
      hasTransportation: keepBoolean(profile.hasTransportation, prefill.hasTransportation),
      willingToTravel: keepBoolean(profile.willingToTravel, prefill.willingToTravel),
      willingToWorkShifts: keepBoolean(profile.willingToWorkShifts, prefill.willingToWorkShifts),
      willingToWorkWeekends: keepBoolean(profile.willingToWorkWeekends, prefill.willingToWorkWeekends),
      targetDayRate: keepOrFill(profile.targetDayRate, prefill.targetDayRate),
      targetAnnualSalary: keepOrFill(profile.targetAnnualSalary, prefill.targetAnnualSalary),
      limitedCompanyName: keepOrFill(profile.limitedCompanyName, prefill.limitedCompanyName),
      companyNumber: keepOrFill(profile.companyNumber, prefill.companyNumber),
      vatRegistered: profile.vatRegistered || prefill.vatRegistered === true,
      experienceText: keepOrFill(profile.experienceText, prefill.experienceText),
      projectsText: keepOrFill(profile.projectsText, prefill.projectsText),
      educationInstitution: keepOrFill(profile.educationInstitution, prefill.educationInstitution),
      educationQualification: keepOrFill(profile.educationQualification, prefill.educationQualification),
      certifications: [
        ...new Set([...(profile.certifications ?? []), ...(prefill.certifications ?? [])]),
      ],
      skills: [...new Set([...(profile.skills ?? []), ...detectedSkills])],
      forwardingEmail: keepOrFill(profile.forwardingEmail, prefill.email),
      defaultCvLabel: profile.defaultCvLabel || payload.filename || "Primary Resume",
      resumeProfiles: (profile.resumeProfiles ?? []).map((item) =>
        item.id === activeProfile.id
          ? {
              ...item,
              name: payload.filename || item.name,
              resumeText: normaliseResumeText(payload.text as string),
            }
          : item,
      ),
    };
    setProfile(nextProfile);
    setCvDetectedSkills(detectedSkills);
    setSuggestedSkills(
      (extraction?.suggestedSkills ?? []).filter(
        (skill) =>
          !(nextProfile.skills ?? []).some(
            (current) => current.toLocaleLowerCase("en-GB") === skill.toLocaleLowerCase("en-GB"),
          ) && !detectedSkills.includes(skill),
      ),
    );
    setSkillSuggestionDetails(
      (extraction?.skillSuggestions ?? []).filter(
        (suggestion) =>
          !(nextProfile.skills ?? []).some(
            (current) => current.toLocaleLowerCase("en-GB") === suggestion.skill.toLocaleLowerCase("en-GB"),
          ) && !detectedSkills.includes(suggestion.skill),
      ),
    );
    setCvDetectedFields(extraction?.detectedFieldLabels ?? []);
    setTab("details");
    setDocumentNotice("Resume read. Saving the information we found to your profile.");
    const readinessAfterAutofill = evaluateProfileReadiness(nextProfile, payload.text);
    const stored = await persistProfile(nextProfile);
    const foundFields = extraction?.detectedFieldLabels.length ?? 0;
    const remainingLabels = readinessAfterAutofill.missing.map((item) => item.label);
    setDocumentNotice(
      stored
        ? remainingLabels.length > 0
          ? `Resume saved. ${foundFields} detail${foundFields === 1 ? " was" : "s were"} filled automatically, including ${detectedSkills.length} confirmed skill${detectedSkills.length === 1 ? "" : "s"}. Please complete: ${remainingLabels.join(", ")}.`
          : `Resume saved. ${foundFields} detail${foundFields === 1 ? " was" : "s were"} filled automatically and your application profile is ready.`
        : "Your resume was read, but the extracted profile could not be saved. Check your connection and select Save profile.",
    );
    window.setTimeout(
      () => document.getElementById("application-readiness")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      100,
    );
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
      setDocumentNotice(payload.error ?? "The resume could not be downloaded.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${profile.fullName || "Candidate"}-Resume.${format}`;
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

  const resumeReady = (activeProfile?.resumeText.trim().length ?? 0) >= 120;
  const firstTimeResumeRequired = !profile.profileSetupCompletedAt && !resumeReady;

  if (firstTimeResumeRequired) {
    return (
      <WorkspacePage
        eyebrow="Profile setup"
        title="Start with your resume"
        description="Upload your resume first. IR35Careers will securely extract the details it can verify, save them to your profile and then ask only for what is missing."
      >
        <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-card">
          <div className="bg-gradient-to-br from-slate-950 to-emerald-950 px-6 py-7 text-white sm:px-8 sm:py-9">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">Step 1 of 3</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Upload your primary resume</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200">
              We use the resume to prefill your name, contact details, role, experience, education, certifications, links and verified skills. Existing information is never overwritten.
            </p>
          </div>
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <label className="ir35-focus flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 px-6 text-center transition hover:border-emerald-500 hover:bg-emerald-100/70">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(event) => void parseResume(event)}
                  className="sr-only"
                />
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm"><Upload size={24} aria-hidden="true" /></span>
                <span className="mt-4 text-base font-bold text-slate-950">Choose your resume</span>
                <span className="mt-1 text-sm text-slate-600">PDF, DOCX or TXT, up to 5 MB</span>
              </label>
              {documentNotice && (
                <p role="status" className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-semibold leading-6 text-brand-900">
                  {documentNotice}
                </p>
              )}
              {saveError && (
                <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-800">{saveError}</p>
              )}
            </div>
            <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="font-semibold text-slate-950">What happens next</h3>
              <ol className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
                <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">1</span><span>Your resume is read and the extracted facts are saved privately.</span></li>
                <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">2</span><span>You review the information and confirm suggested skills.</span></li>
                <li className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">3</span><span>We show only the missing application details for you to complete.</span></li>
              </ol>
              <div className="mt-5 flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>Eligibility and sensitive answers are never guessed from nationality or missing information. We only use a direct statement in your resume; anything else stays for you to confirm.</p>
              </div>
            </aside>
          </div>
        </section>
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage
      eyebrow="Contractor profile"
      title="Your professional profile"
      description="Keep your Resume, experience and reusable application answers ready for every contract."
    >
      <section
        id="application-readiness"
        className={`scroll-mt-24 rounded-2xl border bg-white p-3 shadow-[0_16px_45px_-36px_rgba(15,23,42,0.45)] sm:p-5 ${readiness.complete ? "border-emerald-200" : "border-amber-200"}`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${readiness.complete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
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
              <h2 className="mt-0.5 text-lg font-semibold text-slate-950 sm:mt-1 sm:text-xl">
                {readiness.complete
                  ? "Ready for applications"
                  : `${readiness.missing.length} detail${readiness.missing.length === 1 ? "" : "s"} to complete`}
              </h2>
              <p className="mt-1 hidden max-w-3xl text-sm leading-6 text-slate-600 sm:block">
                Finish these details once so future application forms need less input.
              </p>
            </div>
          </div>
          <div className="min-w-44 lg:w-48">
            <div className="h-2 overflow-hidden rounded-full bg-white/80">
              <div
                className={`h-full rounded-full ${readiness.complete ? "bg-emerald-600" : "bg-amber-500"}`}
                style={{ width: `${readiness.percentage}%` }}
              />
            </div>
            <p className="mt-1.5 text-right text-xs font-bold text-slate-800 sm:mt-2 sm:text-sm">
              {readiness.percentage}% complete
            </p>
          </div>
        </div>
        {!readiness.complete && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 sm:mt-4 sm:pt-4">
            {readiness.missing.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(
                    item.section === "cv"
                      ? "resume"
                      : "details",
                  );
                  if (item.section !== "cv") {
                    setDetailsSection(
                      item.section === "professional" || ["full-name", "phone", "email"].includes(item.id)
                        ? "identity"
                        : item.section === "eligibility" || item.id === "availability"
                          ? "experience"
                          : "answers",
                    );
                  }
                  const targetId =
                    item.section === "cv"
                      ? "profile-resume"
                      : item.section === "professional" ||
                            ["full-name", "phone", "email"].includes(item.id)
                          ? "profile-professional-details"
                          : item.section === "eligibility" || item.id === "availability"
                            ? "work-authorisation"
                            : "reusable-answers";
                  window.setTimeout(
                    () =>
                      document
                        .getElementById(targetId)
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        }),
                    50,
                  );
                }}
                className="ir35-focus inline-flex min-h-9 items-center gap-2 rounded-full border border-amber-200 bg-amber-50/60 px-3 text-left text-[11px] font-semibold text-slate-800 hover:bg-amber-50 sm:text-xs"
              >
                <AlertCircle size={14} className="shrink-0 text-amber-600" />{" "}
                {item.label}
              </button>
            ))}
            {readiness.missing.length > 4 && (
              <p className="flex min-h-9 items-center px-2 text-xs font-semibold text-slate-600">
                Complete these first, then review {readiness.missing.length - 4} more detail{readiness.missing.length - 4 === 1 ? "" : "s"}.
              </p>
            )}
          </div>
        )}
      </section>
      {documentNotice && (
        <p role="status" className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-semibold leading-6 text-brand-900">
          {documentNotice}
        </p>
      )}
      <div className="sticky top-[68px] z-20 mt-5 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.5)] backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Profile sections">
          {PROFILE_NAVIGATION.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={activeNavigationId === item.id}
              onClick={() => selectProfileSection(item.id)}
              className={`ir35-focus min-h-10 shrink-0 rounded-xl px-3 text-xs font-semibold xl:flex-1 xl:px-4 xl:text-sm ${activeNavigationId === item.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t border-slate-100 px-1 pt-1 lg:border-l lg:border-t-0 lg:pl-2 lg:pt-0">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="ir35-focus inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-xs font-bold text-white hover:bg-brand-800 disabled:cursor-wait disabled:opacity-60 lg:flex-none"
          >
            {saved ? <Check size={15} /> : <Save size={15} />} {saving ? "Saving" : saved ? "Profile saved" : "Save profile"}
          </button>
          {saved && readiness.complete && returnTo ? (
            <Link href={returnTo} className="ir35-focus inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-brand-300 bg-white px-3 text-xs font-bold text-brand-800">Continue <ArrowRight size={15} /></Link>
          ) : null}
        </div>
      </div>
      {saveError ? <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{saveError}</p> : null}

      {(tab === "resume" || tab === "cover") && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_45px_-36px_rgba(15,23,42,0.45)] sm:p-5">
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
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={addResumeProfile} disabled={resumeProfiles.length >= 5} className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"><Plus size={14} /> Add version</button>
              <button type="button" onClick={makeDefault} disabled={activeProfile?.isDefault} className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"><Star size={14} /> Make default</button>
              <button type="button" onClick={deleteResumeProfile} disabled={resumeProfiles.length === 1} aria-label="Delete Resume version" className="ir35-focus flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 text-rose-700 disabled:opacity-30"><Trash2 size={15} /></button>
            </div>
          </div>
          {activeProfile && (
            <label className="mt-3 block max-w-md text-xs font-semibold text-slate-600">
              Version name
              <input value={activeProfile.name} onChange={(event) => setActiveProfile((current) => ({ ...current, name: event.target.value }))} maxLength={80} className="ir35-focus mt-2 min-h-10 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal text-slate-900" />
            </label>
          )}
        </section>
      )}

      {tab === "details" && (
        <div className="mt-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            {detailsSection === "identity" && (
              <>
            <section id="profile-professional-details" className="scroll-mt-24 rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
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
              {cvDetectedFields.length > 0 && (
                <div role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                  <p className="font-semibold">Filled from your resume</p>
                  <p className="mt-1 leading-6">
                    {cvDetectedFields.join(", ")}. Existing profile information was kept. Review these details before saving.
                  </p>
                </div>
              )}
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
                  Skills explicitly found in your resume are added. Related skills stay as suggestions until you confirm them.
                </p>
                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addSkill(customSkill);
                  }}
                >
                  <label className="min-w-0 flex-1 text-xs font-semibold text-slate-700">
                    Add your own skill
                    <input
                      value={customSkill}
                      onChange={(event) => setCustomSkill(event.target.value)}
                      placeholder="For example: FinOps"
                      maxLength={80}
                      className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-normal"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!customSkill.trim()}
                    className="ir35-focus mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-40"
                  >
                    <Plus size={15} /> Add
                  </button>
                </form>
                <div className="mt-3 flex flex-wrap gap-2">
                  {skills.map((skill) => (
                    <button
                      type="button"
                      key={skill}
                      onClick={() => removeSkill(skill)}
                      aria-label={`Remove ${skill}`}
                      className={`ir35-focus inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${cvDetectedSkills.includes(skill) ? "bg-emerald-100 text-emerald-900" : "bg-brand-50 text-brand-800"}`}
                    >
                      {skill} <X size={12} aria-hidden="true" />
                    </button>
                  ))}
                </div>
                {suggestedSkills.length > 0 && (
                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                      Suggestions based on your resume
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      These adjacent skills are recommended from your role and the experience already found. Add only skills you can support with real work.
                    </p>
                    <div className="mt-3 grid gap-2">
                      {suggestedSkills.map((skill) => {
                        const detail = skillSuggestionDetails.find((item) => item.skill === skill);
                        return (
                        <button
                          type="button"
                          key={skill}
                          onClick={() => addSkill(skill)}
                          aria-label={`Add suggested skill ${skill}`}
                          className="ir35-focus flex min-h-14 w-full items-start gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-left hover:border-brand-400 hover:bg-brand-50"
                        >
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-brand-700 shadow-sm"><Plus size={13} aria-hidden="true" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold text-slate-950">{skill}</span>
                            <span className="mt-0.5 block text-xs font-normal leading-5 text-slate-600">
                              {detail?.reason ?? "Suggested from the role and skills found in your resume."}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                            Add
                          </span>
                        </button>
                        );
                      })}
                    </div>
                  </div>
                )}
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
              </>
            )}
            {detailsSection === "experience" && (
              <>
            <section id="work-authorisation" className="scroll-mt-24 rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
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
                    Explicit statements in your resume are filled automatically. Anything unstated stays blank for you to confirm.
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
              </>
            )}
            {detailsSection === "answers" && (
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
            )}
            {detailsSection === "company" && (
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
            )}
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
        </div>
      )}

      {tab === "resume" && activeProfile && (
        <div
          id="profile-resume"
          className="mt-6 scroll-mt-24 grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]"
        >
          <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_45px_-36px_rgba(15,23,42,0.45)]">
            <div className="flex items-center gap-3">
              <FileText className="text-brand-700" />
              <div>
                <h2 className="font-semibold">Resume studio</h2>
                <p className="text-xs text-slate-500">
                  Edit, format and export the active resume version.
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
              <button
                type="button"
                aria-pressed={resumeEditing}
                onClick={() => setResumeEditing((current) => !current)}
                className={`ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-bold ${resumeEditing ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 text-slate-700"}`}
              >
                {resumeEditing ? "Close editor" : "Edit Resume text"}
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
            {resumeEditing && <label className="block text-xs font-semibold">
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
            </label>}
          </section>
          <article className="min-h-[760px] rounded-2xl bg-[#e8ecef] p-4 shadow-inner sm:p-8">
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
                    Add your resume text to preview it here.
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
              in your resume.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {(
                [
                  {
                    id: "off",
                    label: "Off",
                    help: "Keep the source resume unchanged.",
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
                    label: "Auto-approve safe resume edits",
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
              answers. You choose whether each application pauses for review or
              uses your saved Auto Apply permission.
            </p>
          </aside>
        </div>
      )}

      {saved && <p role="status" className="mt-5 text-sm font-semibold text-emerald-700">All profile sections are saved.</p>}
    </WorkspacePage>
  );
}
