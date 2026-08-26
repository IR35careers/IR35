"use client";

import Link from "next/link";
import {
  useMemo,
  useState,
  useEffect,
  useEffectEvent,
  useRef,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  LockKeyhole,
  MapPin,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  WorkspacePage,
  StatusPill,
} from "@/components/workspace/WorkspacePage";
import { ApplicationRecordWorkspace } from "@/components/workspace/ApplicationRecordWorkspace";
import { ApplicationProgressDialog } from "@/components/ui/application-progress-dialog";
import { applyAiTailoringSuggestions } from "@/lib/ai/tailoring";
import { buildLocalTailoringResult } from "@/lib/ai/local-tailoring";
import type { AiTailoringResult } from "@/lib/ai/tailoring-types";
import type { TailoringMode } from "@/lib/ai/openrouter-tailoring";
import { roleTypeWarning } from "@/lib/ats/submission-route";
import {
  hasActiveSubmission,
  latestSubmissionLifecycleEvent,
} from "@/lib/application-submission-state";
import { resolveApplicationProgressPhase } from "@/lib/application-progress";
import { fetchWithFreshSession } from "@/lib/authenticated-fetch";
import {
  normaliseCoverLetterSignoff,
  normaliseCoverLetterTerminology,
  resolveCandidateName,
  stripCoverLetterSignoff,
} from "@/lib/candidate-name";
import type { JobDetail } from "@/lib/job-types";
import { scoreResumeForRole } from "@/lib/resume/analysis";
import { normaliseResumeText } from "@/lib/resume/normalise-text";
import { getSupabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { newWorkspaceId } from "@/lib/workspace/engine";
import { evaluateProfileReadiness } from "@/lib/workspace/profile-readiness";
import { buildApplicationAttention } from "@/lib/application-attention";
import { applicationProfileHref } from "@/lib/application-profile-return";
import { needsApplicationMaterialApproval } from "@/lib/application-material-approval";
import {
  SAMPLE_CONTRACTOR_PROFILE,
  SAMPLE_CV_TEXT,
} from "@/lib/workspace/seed";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { ApplicationRecord } from "@/lib/workspace/types";
import { rememberReviewedApplicationAnswers } from "@/lib/workspace/answer-memory";

type BusyState =
  | "parse"
  | "prepare"
  | "ai"
  | "save"
  | "submit"
  | null;
type ConnectionState = "connected" | "gated";

const WORKFLOW_STEPS = [
  { label: "Resume", helper: "Choose what to use" },
  { label: "Review", helper: "Check your application" },
  { label: "Apply", helper: "Confirm and send" },
] as const;

function persistApplication(application: ApplicationRecord) {
  updateWorkspace((current) => ({
    ...current,
    applications: [
      application,
      ...current.applications.filter(
        (item) =>
          item.id !== application.id && item.job.id !== application.job.id,
      ),
    ],
  }));
}

function cleanExisting(
  application: ApplicationRecord | undefined,
  profileName: string,
): ApplicationRecord | null {
  if (!application) return null;
  const candidateName = resolveCandidateName(
    profileName,
    application.sourceCvText,
  );
  const coverLetter = candidateName
    ? normaliseCoverLetterSignoff(application.coverLetter, candidateName)
    : normaliseCoverLetterTerminology(
        stripCoverLetterSignoff(application.coverLetter),
      );
  const cleaned = {
    ...application,
    sourceCvText: normaliseResumeText(application.sourceCvText),
    tailoredCvText: normaliseResumeText(application.tailoredCvText),
    coverLetter,
  };
  if (application.receipt?.mode === "external_handoff") return cleaned;
  return { ...cleaned, receipt: null };
}

export function ApplicationStudio({ job }: { job: JobDetail }) {
  const workspace = useWorkspaceState();
  const existing = workspace.applications.find(
    (item) => item.job.id === job.id && item.id !== "app-demo-northstar",
  );
  const initialApplication = useMemo(
    () => cleanExisting(existing, workspace.profile.fullName),
    [existing, workspace.profile.fullName],
  );
  const preferredResume = useMemo(
    () =>
      workspace.profile.resumeProfiles?.find(
        (item) => item.id === workspace.profile.activeResumeProfileId,
      ) ??
      workspace.profile.resumeProfiles?.find((item) => item.isDefault) ??
      workspace.profile.resumeProfiles?.[0],
    [workspace.profile.activeResumeProfileId, workspace.profile.resumeProfiles],
  );
  const applicationPreferences = workspace.profile.applicationPreferences ?? {
    resumeOptimisation: "honest" as const,
    autoApproveSafeEdits: true,
    reviewBeforeSubmit: true,
    generateCoverLetter: true,
    usePrivateApplicationEmail: true,
  };
  const [cvText, setCvText] = useState(
    initialApplication?.sourceCvText ?? preferredResume?.resumeText ?? "",
  );
  const [cvFilename, setCvFilename] = useState(
    initialApplication?.resumeVersionLabel ??
      preferredResume?.name ??
      workspace.profile.defaultCvLabel ??
      "",
  );
  const [showResumeEditor, setShowResumeEditor] = useState(false);
  const [application, setApplication] = useState<ApplicationRecord | null>(
    initialApplication,
  );
  const [busy, setBusy] = useState<BusyState>(null);
  const [submissionConnection] = useState<ConnectionState>(
    isSupabaseConfigured() ? "connected" : "gated",
  );
  const [submitElapsedSeconds, setSubmitElapsedSeconds] = useState(0);
  const [tailoringElapsedSeconds, setTailoringElapsedSeconds] = useState(0);
  const [useAiCoverLetter, setUseAiCoverLetter] = useState(false);
  const [aiResult, setAiResult] = useState<AiTailoringResult | null>(null);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [profilePrompt, setProfilePrompt] = useState(false);
  const [submissionProgressOpen, setSubmissionProgressOpen] = useState(false);
  const submissionStatusFailures = useRef(0);
  const profileResumeAttempted = useRef(false);
  const profileCompletionHref = applicationProfileHref(job.id);

  const engagementWarning = useMemo(() => roleTypeWarning(job), [job]);
  const profileReadiness = useMemo(
    () =>
      evaluateProfileReadiness(
        workspace.profile,
        preferredResume?.resumeText || cvText,
      ),
    [cvText, preferredResume?.resumeText, workspace.profile],
  );
  const cvReady = cvText.trim().length >= 120;
  const answersReviewed = Boolean(
    application?.questions.every(
      (item) =>
        !item.required || (item.reviewed && item.answer.trim().length > 0),
    ),
  );
  const approvalsComplete = Boolean(
    application?.truthApproved &&
    application.materialsApproved &&
    application.submissionApproved,
  );
  const submitted =
    application?.status === "applied" &&
    application.receipt?.mode === "external_handoff";
  const submissionInProgress = Boolean(
    application &&
      hasActiveSubmission(
        application.status,
        application.events,
        application.attention,
      ),
  );
  const submissionProgressPhase = resolveApplicationProgressPhase({
    submitted,
    busy: busy === "submit",
    submissionInProgress,
    hasAttention: Boolean(application?.attention),
    hasError: Boolean(error),
    elapsedSeconds: submitElapsedSeconds,
  });
  const selectedSuggestions =
    aiResult?.suggestions.filter((item) =>
      selectedSuggestionIds.includes(item.id),
    ) ?? [];
  const requiredQuestions =
    application?.questions.filter((question) => question.required) ?? [];
  const reusableQuestions =
    application?.questions.filter((question) => !question.required) ?? [];
  const selectedPreview = aiResult
    ? applyAiTailoringSuggestions(
        application?.sourceCvText ?? cvText,
        selectedSuggestions,
      )
    : "";
  const selectedScore = selectedPreview
    ? scoreResumeForRole(selectedPreview, job, cvFilename || "Application Resume")
        .overall
    : (application?.matchScore ?? 0);
  const checklist = [
    cvReady,
    Boolean(application),
    answersReviewed,
    approvalsComplete,
  ];
  const progress = Math.round(
    (checklist.filter(Boolean).length / checklist.length) * 100,
  );
  const activeStep = !application ? 0 : answersReviewed ? 2 : 1;
  const attention = application?.attention ?? null;
  const showDemoTools = process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (application || !initialApplication) return;
    setApplication(initialApplication);
    if (!cvText.trim() && initialApplication.sourceCvText.trim()) {
      setCvText(initialApplication.sourceCvText);
      setCvFilename(initialApplication.resumeVersionLabel);
    }
  }, [application, cvText, initialApplication]);

  useEffect(() => {
    if (application || cvText.trim() || !preferredResume?.resumeText.trim())
      return;
    setCvText(preferredResume.resumeText);
    setCvFilename(
      preferredResume.name || workspace.profile.defaultCvLabel || "Application Resume",
    );
  }, [
    application,
    cvText,
    preferredResume?.name,
    preferredResume?.resumeText,
    workspace.profile.defaultCvLabel,
  ]);

  useEffect(() => {
    if (busy !== "submit") {
      setSubmitElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(
      () =>
        setSubmitElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (busy !== "ai") {
      setTailoringElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(
      () =>
        setTailoringElapsedSeconds(
          Math.floor((Date.now() - startedAt) / 1_000),
        ),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!application || !submissionInProgress || !isSupabaseConfigured())
      return;
    let active = true;
    const applicationId = application.id;
    const stopLocalSubmission = (
      message: string,
      action?: string,
      attention?: ApplicationRecord["attention"],
    ) => {
      const now = new Date().toISOString();
      const sourceUnavailable = action === "source_access_denied";
      const eventLabel = sourceUnavailable
        ? "Employer application page is unavailable"
        : attention?.title || "Application needs review";
      const next: ApplicationRecord = {
        ...application,
        status: sourceUnavailable ? "failed" : "ready",
        attention: attention ?? application.attention,
        updatedAt: now,
        events:
          latestSubmissionLifecycleEvent(application.events)?.label === eventLabel
            ? application.events
            : [
                ...application.events,
                {
                  id: newWorkspaceId(),
                  applicationId,
                  type: "status_changed",
                  label: eventLabel,
                  metadata: attention ? { attention } : undefined,
                  createdAt: now,
                },
              ],
      };
      setApplication(next);
      persistApplication(next);
      setNotice(null);
      setError(message);
    };
    const refresh = async () => {
      try {
        const response = await fetchWithFreshSession(
          `/api/applications/submission-status?applicationId=${encodeURIComponent(applicationId)}`,
          { cache: "no-store", signal: AbortSignal.timeout(15_000) },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          state?: "submitted" | "processing" | "needs_user" | "failed";
          receipt?: ApplicationRecord["receipt"];
          questions?: ApplicationRecord["questions"];
          attention?: ApplicationRecord["attention"];
          action?: string;
          message?: string;
          error?: string;
        };
        if (!active) return;
        submissionStatusFailures.current = 0;
        if (payload.state === "processing") return;
        if (payload.state === "submitted" && payload.receipt) {
          const now = new Date().toISOString();
          const next: ApplicationRecord = {
            ...application,
            status: "applied",
            mode: "external_handoff",
            receipt: payload.receipt,
            updatedAt: now,
            events: [
              ...application.events,
              {
                id: newWorkspaceId(),
                applicationId,
                type: "status_changed",
                label: "Application submitted successfully",
                createdAt: now,
              },
            ],
          };
          setApplication(next);
          persistApplication(next);
          setError(null);
          setNotice(
            "Application submitted. The verified employer receipt is saved below.",
          );
          return;
        }
        if (payload.state === "needs_user") {
          const now = new Date().toISOString();
          const questions = payload.questions ?? application.questions;
          const next: ApplicationRecord = {
            ...application,
            status: "needs_review",
            questions,
            attention:
              payload.attention ??
              buildApplicationAttention({
                action: payload.action,
                message: payload.message,
                questions: payload.questions ?? application.questions,
              }),
            submissionApproved: needsApplicationMaterialApproval(questions)
              ? false
              : application.submissionApproved,
            updatedAt: now,
            events: [
              ...application.events,
              {
                id: newWorkspaceId(),
                applicationId,
                type: "status_changed",
                label:
                  payload.attention?.title || "Application needs your answer",
                metadata: payload.attention
                  ? { attention: payload.attention }
                  : undefined,
                createdAt: now,
              },
            ],
          };
          setApplication(next);
          persistApplication(next);
          if (payload.action === "/profile") setProfilePrompt(true);
          setError(null);
          setNotice(
            payload.message ||
              "The employer needs information from you before the application can continue.",
          );
          return;
        }
        if (payload.state === "failed") {
          stopLocalSubmission(
            payload.error ||
              "The employer form could not be completed. Your approved materials are safe and ready to retry.",
            payload.action,
            payload.attention,
          );
          return;
        }
        if (!response.ok && response.status !== 202) {
          submissionStatusFailures.current += 1;
          setNotice(
            "The live status update is delayed. The application is still being checked and has not been marked as failed.",
          );
        }
      } catch {
        submissionStatusFailures.current += 1;
        if (active && submissionStatusFailures.current >= 3) {
          setNotice(
            "The live status update is delayed. The application is still being checked and has not been marked as failed.",
          );
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [application, submissionInProgress]);

  const updateApplication = (
    updater: (current: ApplicationRecord) => ApplicationRecord,
  ) => {
    if (!application || submitted) return;
    const next: ApplicationRecord = {
      ...updater(application),
      receipt:
        application.receipt?.mode === "external_handoff"
          ? application.receipt
          : null,
      updatedAt: new Date().toISOString(),
    };
    setApplication(next);
    persistApplication(next);
  };

  const parseCvFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("parse");
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/resume/parse", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        text?: string;
        filename?: string;
        error?: string;
      };
      if (!response.ok || !payload.text)
        throw new Error(payload.error ?? "We could not read that Resume.");
      setCvText(payload.text);
      setCvFilename(payload.filename || file.name);
      setApplication(null);
      setAiResult(null);
      setSelectedSuggestionIds([]);
      setShowResumeEditor(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "We could not read that Resume.",
      );
    } finally {
      setBusy(null);
    }
  };

  const requestTailoring = async (
    sourceCvText: string,
  ): Promise<{ result: AiTailoringResult; mode: TailoringMode }> => {
    const response = await fetchWithFreshSession("/api/applications/tailor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cvText: sourceCvText, job }),
      signal: AbortSignal.timeout(42_000),
    });
    const payload = (await response.json()) as {
      result?: AiTailoringResult;
      mode?: TailoringMode;
      error?: string;
    };
    if (!response.ok || !payload.result)
      throw new Error(payload.error ?? "Tailoring could not be completed.");
    return { result: payload.result, mode: payload.mode ?? "local" };
  };

  const mergeTailoringResult = (
    prepared: ApplicationRecord,
    result: AiTailoringResult,
  ): ApplicationRecord => {
    const tailoredCvText = applicationPreferences.autoApproveSafeEdits
      ? applyAiTailoringSuggestions(prepared.sourceCvText, result.suggestions)
      : prepared.sourceCvText;
    const score = scoreResumeForRole(
      tailoredCvText,
      job,
      prepared.resumeVersionLabel,
    );
    const candidateName = resolveCandidateName(
      workspace.profile.fullName,
      prepared.sourceCvText,
    );
    return {
      ...prepared,
      tailoredCvText,
      coverLetter:
        applicationPreferences.generateCoverLetter &&
        result.coverLetter &&
        candidateName
          ? normaliseCoverLetterSignoff(result.coverLetter, candidateName)
          : prepared.coverLetter,
      matchScore: score.overall,
      matchedKeywords: score.matchedKeywords,
      missingKeywords: score.missingKeywords,
    };
  };

  const prepare = async (inputCv = cvText, inputFilename = cvFilename) => {
    setBusy("prepare");
    setError(null);
    setNotice(null);
    setAiResult(null);
    setSelectedSuggestionIds([]);
    try {
      const response = await fetch("/api/applications/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job,
          profile: workspace.profile ?? SAMPLE_CONTRACTOR_PROFILE,
          cvText: inputCv,
          resumeVersionLabel:
            inputFilename ||
            workspace.profile.defaultCvLabel ||
            "Application Resume",
        }),
      });
      const payload = (await response.json()) as {
        application?: ApplicationRecord;
        error?: string;
      };
      if (!response.ok || !payload.application)
        throw new Error(payload.error ?? "Could not analyse this Resume.");
      let prepared = applicationPreferences.generateCoverLetter
        ? payload.application
        : {
            ...payload.application,
            coverLetter: preferredResume?.coverLetter ?? "",
          };
      let tailoringNotice =
        "Your role match is ready. Review the application details before submitting.";
      if (applicationPreferences.resumeOptimisation !== "off") {
        const immediateResult = buildLocalTailoringResult(
          prepared.sourceCvText,
          job,
        );
        prepared = mergeTailoringResult(prepared, immediateResult);
        setAiResult(immediateResult);
        setSelectedSuggestionIds(
          applicationPreferences.autoApproveSafeEdits
            ? immediateResult.suggestions.map((suggestion) => suggestion.id)
            : [],
        );
        setApplication(prepared);
        persistApplication(prepared);
        setNotice(
          "Your role match is ready. Finishing the wording review now.",
        );
        setBusy("ai");
        try {
          const tailoringPayload = await requestTailoring(
            prepared.sourceCvText,
          );
          const result = tailoringPayload.result;
          prepared = mergeTailoringResult(prepared, result);
          setAiResult(result);
          setSelectedSuggestionIds(
            applicationPreferences.autoApproveSafeEdits
              ? result.suggestions.map((suggestion) => suggestion.id)
              : [],
          );
          setUseAiCoverLetter(
            applicationPreferences.generateCoverLetter &&
              Boolean(result.coverLetter),
          );
          tailoringNotice =
            result.suggestions.length > 0 &&
            applicationPreferences.autoApproveSafeEdits
              ? `${result.suggestions.length} evidence-based Resume improvements were applied for this role. Review them before submitting.`
              : result.suggestions.length > 0
                ? `${result.suggestions.length} evidence-based Resume improvements are ready for your review.`
                : "Your Resume was checked against the role. No safe wording changes were needed.";
        } catch {
          tailoringNotice =
            "Your role match is ready using verified evidence from your Resume.";
        }
      } else
        tailoringNotice =
          "Resume optimisation is off for this profile. Your source Resume remains unchanged.";
      setApplication(prepared);
      persistApplication(prepared);
      setNotice(tailoringNotice);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not analyse this Resume.",
      );
    } finally {
      setBusy(null);
    }
  };

  const runAiTailoring = async () => {
    if (!application) return;
    const immediateResult = buildLocalTailoringResult(
      application.sourceCvText,
      job,
    );
    setAiResult(immediateResult);
    setSelectedSuggestionIds([]);
    setBusy("ai");
    setError(null);
    setNotice("Your role evidence is ready. Finishing the wording review now.");
    try {
      const payload = await requestTailoring(application.sourceCvText);
      const suggestionIds = payload.result.suggestions.map(
        (suggestion) => suggestion.id,
      );
      setAiResult(payload.result);
      setSelectedSuggestionIds(suggestionIds);
      setUseAiCoverLetter(
        applicationPreferences.generateCoverLetter &&
          Boolean(payload.result.coverLetter),
      );
      if (
        applicationPreferences.autoApproveSafeEdits &&
        suggestionIds.length > 0
      ) {
        const next = mergeTailoringResult(application, payload.result);
        const updated = {
          ...next,
          status: "needs_review" as const,
          truthApproved: false,
          materialsApproved: false,
          submissionApproved: false,
          updatedAt: new Date().toISOString(),
        };
        setApplication(updated);
        persistApplication(updated);
        setNotice(
          `Tailoring refreshed and ${suggestionIds.length} verified Resume improvement${suggestionIds.length === 1 ? " was" : "s were"} applied. Review the final Resume before approving it.`,
        );
      } else {
        setNotice(
          `Tailoring refreshed. ${suggestionIds.length} verified Resume improvement${suggestionIds.length === 1 ? " is" : "s are"} selected for your review.`,
        );
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (/session|sign in/i.test(message)) setError(message);
      else
        setError(
          message ||
            "The wording refresh could not finish. Your existing Resume has not been changed. Try again in a moment.",
        );
    } finally {
      setBusy(null);
    }
  };

  const applySelectedEdits = () => {
    if (!application || !aiResult || selectedSuggestions.length === 0) {
      setError("Select at least one suggested edit first.");
      return;
    }
    const tailoredCvText = applyAiTailoringSuggestions(
      application.sourceCvText,
      selectedSuggestions,
    );
    const score = scoreResumeForRole(
      tailoredCvText,
      job,
      application.resumeVersionLabel,
    );
    const candidateName = resolveCandidateName(
      workspace.profile.fullName,
      application.sourceCvText,
    );
    updateApplication((current) => ({
      ...current,
      tailoredCvText,
      coverLetter:
        useAiCoverLetter && aiResult.coverLetter && candidateName
          ? normaliseCoverLetterSignoff(aiResult.coverLetter, candidateName)
          : current.coverLetter,
      matchScore: score.overall,
      matchedKeywords: score.matchedKeywords,
      missingKeywords: score.missingKeywords,
      status: "needs_review",
      truthApproved: false,
      materialsApproved: false,
      submissionApproved: false,
    }));
    setError(null);
    setNotice(
      `${selectedSuggestions.length} approved edit${selectedSuggestions.length === 1 ? "" : "s"} applied to your Resume. Review the full text below.`,
    );
  };

  const recalculateEditedCv = () => {
    if (!application) return;
    const tailoredCvText = normaliseResumeText(application.tailoredCvText);
    const score = scoreResumeForRole(
      tailoredCvText,
      job,
      application.resumeVersionLabel,
    );
    updateApplication((current) => ({
      ...current,
      tailoredCvText,
      matchScore: score.overall,
      matchedKeywords: score.matchedKeywords,
      missingKeywords: score.missingKeywords,
    }));
  };

  const persistReviewedPacket = async (
    source: ApplicationRecord,
    syncWholeWorkspace = true,
  ): Promise<ApplicationRecord> => {
    const now = new Date().toISOString();
    const ready: ApplicationRecord = {
      ...source,
      status: "ready",
      mode: "dry_run",
      receipt: null,
      updatedAt: now,
      events: [
        ...source.events,
        {
          id: newWorkspaceId(),
          applicationId: source.id,
          type: "approved",
          label: "Application approved and ready to submit",
          createdAt: now,
        },
      ],
    };
    setApplication(ready);
    persistApplication(ready);
    const rememberedProfile = rememberReviewedApplicationAnswers(
      workspace.profile,
      ready.questions,
      now,
    );
    updateWorkspace((current) => ({
      ...current,
      profile: rememberReviewedApplicationAnswers(
        current.profile,
        ready.questions,
        now,
      ),
    }));
    if (syncWholeWorkspace && isSupabaseConfigured()) {
      const { data } = await getSupabase().auth.getSession();
      if (!data.session)
        throw new Error("Sign in again before saving this application.");
      const { saveCloudWorkspace } = await import("@/lib/workspace/repository");
      await saveCloudWorkspace(data.session.user.id, {
        ...workspace,
        profile: rememberedProfile,
        applications: [
          ready,
          ...workspace.applications.filter(
            (item) => item.id !== ready.id && item.job.id !== ready.job.id,
          ),
        ],
      });
    }
    return ready;
  };

  const saveReviewedPacket = async (): Promise<boolean> => {
    if (!application) return false;
    if (!answersReviewed || !approvalsComplete) {
      setError(
        "Review every required answer and complete all three approval checks first.",
      );
      return false;
    }
    setBusy("save");
    setError(null);
    try {
      await persistReviewedPacket(application);
      setNotice("Reviewed packet saved. It has not been sent to the employer.");
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save this packet.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  const submitApprovedApplication = async () => {
    if (!application) return;
    setSubmissionProgressOpen(true);
    if (submissionConnection !== "connected") {
      setError(
        "The application service is temporarily unavailable. Your approved application is saved and has not been submitted.",
      );
      return;
    }
    if (!answersReviewed) {
      setError("Review every required answer before applying.");
      return;
    }
    if (!approvalsComplete) {
      setError(
        "Confirm that the final application is accurate, truthful and ready to submit.",
      );
      return;
    }
    setBusy("submit");
    submissionStatusFailures.current = 0;
    setError(null);
    setNotice(null);
    try {
      const ready =
        application.status === "ready" && approvalsComplete
          ? application
          : await persistReviewedPacket(application, false);
      setNotice(
        "Starting the secure employer application. You can leave this page while it completes.",
      );
      const response = await fetchWithFreshSession("/api/applications/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: ready.id,
          approval: "SUBMIT_APPROVED_APPLICATION",
          packet: ready,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const payload = (await response.json().catch(() => ({
        error:
          "The employer application service returned an unreadable response.",
      }))) as {
        receipt?: ApplicationRecord["receipt"];
        state?: "submitted" | "processing" | "needs_user" | "failed";
        message?: string;
        questions?: ApplicationRecord["questions"];
        attention?: ApplicationRecord["attention"];
        action?: string;
        error?: string;
        retryAfterSeconds?: number;
      };
      if (response.status === 202 && payload.state) {
        if (payload.state === "needs_user") {
          const questions = payload.questions ?? ready.questions;
          const needsUserApplication: ApplicationRecord = {
            ...ready,
            status: "needs_review",
            questions,
            attention:
              payload.attention ??
              buildApplicationAttention({
                action: payload.action,
                message: payload.message,
                questions: payload.questions ?? ready.questions,
              }),
            submissionApproved: needsApplicationMaterialApproval(questions)
              ? false
              : ready.submissionApproved,
            updatedAt: new Date().toISOString(),
          };
          setApplication(needsUserApplication);
          persistApplication(needsUserApplication);
          if (payload.action === "/profile") setProfilePrompt(true);
          setNotice(null);
          return;
        }
        const submissionStarted: ApplicationRecord = {
          ...ready,
          events: ready.events.some(
            (event) => event.label === "Application submission started",
          )
            ? ready.events
            : [
                ...ready.events,
                {
                  id: newWorkspaceId(),
                  applicationId: ready.id,
                  type: "status_changed",
                  label: "Application submission started",
                  createdAt: new Date().toISOString(),
                },
              ],
          updatedAt: new Date().toISOString(),
        };
        setApplication(submissionStarted);
        persistApplication(submissionStarted);
        if (!payload.receipt) {
          setNotice(
            payload.message ||
              "Your application is being completed securely. Its status will update automatically in Applications.",
          );
          return;
        }
      }
      if (!response.ok && payload.attention) {
        const questions = payload.questions ?? ready.questions;
        const needsUserApplication: ApplicationRecord = {
          ...ready,
          status: "needs_review",
          questions,
          attention: payload.attention,
          submissionApproved: needsApplicationMaterialApproval(questions)
            ? false
            : ready.submissionApproved,
          updatedAt: new Date().toISOString(),
        };
        setApplication(needsUserApplication);
        persistApplication(needsUserApplication);
        if (payload.action === "/profile") setProfilePrompt(true);
        setError(payload.error ?? payload.attention.message);
        return;
      }
      if (!response.ok || !payload.receipt)
        throw new Error(payload.error ?? "The application was not submitted.");
      const now = new Date().toISOString();
      const submittedApplication: ApplicationRecord = {
        ...ready,
        status: "applied",
        attention: undefined,
        mode: "external_handoff",
        receipt: payload.receipt,
        updatedAt: now,
        events: [
          ...ready.events,
          {
            id: newWorkspaceId(),
            applicationId: ready.id,
            type: "status_changed",
            label: "Application submitted successfully",
            createdAt: now,
          },
        ],
      };
      setApplication(submittedApplication);
      persistApplication(submittedApplication);
      setNotice(
        "Application submitted. The verified employer receipt is saved below.",
      );
    } catch (caught) {
      let message =
        caught instanceof DOMException && caught.name === "TimeoutError"
          ? "Employer confirmation was not received within two minutes. This role has not been marked Applied."
          : caught instanceof Error
            ? caught.message
            : "The application was not submitted. Your packet remains saved.";
      if (
        caught instanceof DOMException &&
        caught.name === "TimeoutError" &&
        application
      ) {
        try {
          const statusResponse = await fetchWithFreshSession(
            `/api/applications/submission-status?applicationId=${encodeURIComponent(application.id)}`,
            { cache: "no-store", signal: AbortSignal.timeout(15_000) },
          );
          const statusPayload = (await statusResponse
            .json()
            .catch(() => ({}))) as {
            state?: "submitted" | "processing" | "needs_user" | "failed";
            receipt?: ApplicationRecord["receipt"];
            questions?: ApplicationRecord["questions"];
            attention?: ApplicationRecord["attention"];
            action?: string;
            message?: string;
            error?: string;
            retryAfterSeconds?: number;
          };
          if (statusPayload.receipt) {
            const now = new Date().toISOString();
            const submittedApplication: ApplicationRecord = {
              ...application,
              status: "applied",
              attention: undefined,
              mode: "external_handoff",
              receipt: statusPayload.receipt,
              updatedAt: now,
              events: [
                ...application.events,
                {
                  id: newWorkspaceId(),
                  applicationId: application.id,
                  type: "status_changed",
                  label: "Application submitted successfully",
                  createdAt: now,
                },
              ],
            };
            setApplication(submittedApplication);
            persistApplication(submittedApplication);
            setNotice(
              "Application submitted. The verified employer receipt is saved below.",
            );
            return;
          }
          if (statusPayload.state === "needs_user") {
            const questions =
              statusPayload.questions ?? application.questions;
            const needsUserApplication: ApplicationRecord = {
              ...application,
              status: "needs_review",
              questions,
              attention:
                statusPayload.attention ??
                buildApplicationAttention({
                  action: statusPayload.action,
                  message: statusPayload.message,
                  questions: statusPayload.questions ?? application.questions,
                }),
              submissionApproved: needsApplicationMaterialApproval(questions)
                ? false
                : application.submissionApproved,
              updatedAt: new Date().toISOString(),
            };
            setApplication(needsUserApplication);
            persistApplication(needsUserApplication);
            if (statusPayload.action === "/profile") setProfilePrompt(true);
            setNotice(null);
            return;
          }
          if (statusPayload.state === "processing") {
            const retry = statusPayload.retryAfterSeconds
              ? ` Check again in about ${Math.max(1, Math.ceil(statusPayload.retryAfterSeconds / 60))} minute.`
              : "";
            setNotice(
              `${statusPayload.message || "The employer portal is still processing the application."}${retry}`,
            );
            return;
          }
          message = statusPayload.error || message;
        } catch {
          message = `${message} Open Applications to check the saved result before retrying.`;
        }
      }
      if (
        /complete your application profile|profile before applying/i.test(
          message,
        )
      )
        setProfilePrompt(true);
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const resumeApprovedApplicationAfterProfile = useEffectEvent(() => {
    if (!application) return;
    if (
      !application.submissionApproved &&
      application.truthApproved &&
      application.materialsApproved
    ) {
      updateApplication((current) => ({
        ...current,
        submissionApproved: true,
        updatedAt: new Date().toISOString(),
      }));
      return;
    }
    if (!approvalsComplete) return;

    profileResumeAttempted.current = true;
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("resume");
    window.history.replaceState(
      window.history.state,
      "",
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
    setNotice(
      "Profile saved. IR35Careers is resuming the same approved application now.",
    );
    void submitApprovedApplication();
  });

  useEffect(() => {
    if (profileResumeAttempted.current || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("resume") !== "profile")
      return;
    if (
      !application ||
      application.status !== "needs_review" ||
      !application.attention?.action.startsWith("/profile") ||
      !profileReadiness.complete ||
      !answersReviewed ||
      busy !== null ||
      submissionInProgress ||
      submissionConnection !== "connected"
    )
      return;

    resumeApprovedApplicationAfterProfile();
  }, [
    answersReviewed,
    application,
    approvalsComplete,
    busy,
    profileReadiness.complete,
    submissionConnection,
    submissionInProgress,
  ]);

  const applicationProgressDialog = (
    <ApplicationProgressDialog
      open={submissionProgressOpen && !profilePrompt}
      phase={submissionProgressPhase}
      roleTitle={job.title}
      companyName={job.company_name}
      elapsedSeconds={submitElapsedSeconds}
      message={
        submissionProgressPhase === "attention"
          ? application?.attention?.message
          : submissionProgressPhase === "error"
            ? error
            : submissionProgressPhase === "success"
              ? application?.receipt?.message
              : notice
      }
      onClose={() => setSubmissionProgressOpen(false)}
      onReview={() => {
        setSubmissionProgressOpen(false);
        window.setTimeout(() => {
          document
            .getElementById("needs-attention")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }}
      onRetry={() => void submitApprovedApplication()}
    />
  );

  let recordWorkspace: ReactNode = null;
  if (application) {
    recordWorkspace = (
      <ApplicationRecordWorkspace
        job={job}
        application={application}
        profile={workspace.profile}
        inbox={workspace.inbox}
        messages={workspace.messages}
        busy={busy}
        notice={notice}
        error={error}
        submitted={submitted}
        submissionInProgress={submissionInProgress}
        answersReviewed={answersReviewed}
        approvalsComplete={approvalsComplete}
        onUpdate={updateApplication}
        onSubmit={submitApprovedApplication}
        onRefreshTailoring={runAiTailoring}
        onResumeBlur={recalculateEditedCv}
      />
    );
  }
  if (recordWorkspace) {
    return (
      <>
        {recordWorkspace}
        {applicationProgressDialog}
      </>
    );
  }

  return (
    <WorkspacePage
      density="compact"
      eyebrow="Application workspace"
      title={`Apply to ${job.company_name}`}
      description="Tailor your Resume, confirm the application and apply without leaving your workspace."
      actions={
        <Link
          href={`/jobs/${job.id}`}
          className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={15} /> Role details
        </Link>
      }
    >
      <section
        className="ir35-card overflow-hidden"
        aria-labelledby="application-role-title"
      >
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-lg font-bold text-white">
              {job.company_name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2
                id="application-role-title"
                className="text-lg font-semibold tracking-tight text-slate-950 sm:text-xl"
              >
                {job.title}
              </h2>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <BriefcaseBusiness size={14} />
                  {job.company_name}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} />
                  {job.location} · {job.remote_type}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {application && (
              <span className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">
                {application.matchScore}% match
              </span>
            )}
            {application && <StatusPill status={application.status} />}
            {submitted && (
              <span className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-50 px-3 text-sm font-bold text-emerald-800">
                <CheckCircle2 size={16} /> Submitted
              </span>
            )}
          </div>
        </div>
        <ol
          className="grid gap-2 border-t border-slate-200 bg-slate-50 p-3 sm:grid-cols-3"
          aria-label="Application progress"
        >
          {WORKFLOW_STEPS.map((step, index) => (
            <li
              key={step.label}
              aria-current={activeStep === index ? "step" : undefined}
              className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${activeStep === index ? "border-slate-950 bg-slate-950 text-white" : index < activeStep ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-500"}`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${index < activeStep ? "bg-emerald-600 text-white" : "border border-current"}`}
              >
                {index < activeStep ? <Check size={14} /> : index + 1}
              </span>
              <span>
                <strong className="block text-xs">{step.label}</strong>
                <span className="block text-[10px] opacity-75">
                  {step.helper}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {engagementWarning && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 shrink-0" size={19} />
          <p>
            <strong>Check the engagement type.</strong> {engagementWarning}
          </p>
        </div>
      )}
      {(error || notice) && (
        <p
          role={error ? "alert" : "status"}
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}
        >
          {error ?? notice}
        </p>
      )}
      {!profileReadiness.complete && (
        <section
          className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"
          aria-labelledby="profile-readiness-title"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              size={19}
              className="mt-0.5 shrink-0 text-amber-700"
            />
            <div className="min-w-0 flex-1">
              <h2
                id="profile-readiness-title"
                className="font-semibold text-amber-950"
              >
                Complete your profile before applying
              </h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                {profileReadiness.missing.map((item) => item.label).join(", ")}
              </p>
              <Link
                href={profileCompletionHref}
                className="ir35-focus mt-3 inline-flex min-h-10 items-center rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800"
              >
                Complete profile
              </Link>
            </div>
          </div>
        </section>
      )}
      {attention && application?.status === "needs_review" && (
        <section
          id="needs-attention"
          className="mt-4 scroll-mt-24 rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5"
          aria-labelledby="needs-attention-title"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              size={20}
              className="mt-0.5 shrink-0 text-amber-700"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700">
                Your action
              </p>
              <h2
                id="needs-attention-title"
                className="mt-1 text-lg font-semibold text-amber-950"
              >
                {attention.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-amber-900">
                {attention.message}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {attention.action === "#employer-terms-consent" ||
                attention.message.includes(
                  "Employer account, terms and email verification permission",
                ) ? (
                  <button
                    type="button"
                    onClick={() => void submitApprovedApplication()}
                    disabled={busy !== null || submissionInProgress}
                    className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                  >
                    {busy === "submit" || submissionInProgress ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : null}
                    Retry application
                  </button>
                ) : attention.action.startsWith("/profile") ? (
                  profileReadiness.complete ? (
                    <button
                      type="button"
                      onClick={() => void submitApprovedApplication()}
                      disabled={busy !== null || submissionInProgress}
                      className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                    >
                      {busy === "submit" || submissionInProgress ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : null}
                      Continue application
                    </button>
                  ) : (
                    <Link
                      href={profileCompletionHref}
                      className="ir35-focus inline-flex min-h-10 items-center rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800"
                    >
                      {attention.actionLabel}
                    </Link>
                  )
                ) : attention.kind === "email_verification" ? (
                  <button
                    type="button"
                    onClick={() => void submitApprovedApplication()}
                    disabled={busy !== null || submissionInProgress}
                    className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                  >
                    {busy === "submit" || submissionInProgress ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : null}
                    Retry automatic verification
                  </button>
                ) : attention.kind === "security_check" ||
                attention.kind === "employer_account" ||
                attention.kind === "employer_form" ||
                attention.kind === "retry" ? (
                  <>
                    {attention.questionIds.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          const questionId = attention.questionIds[0];
                          const field = document.getElementById(
                            questionId
                              ? `question-${questionId}`
                              : "employer-questions",
                          );
                          field?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                          if (field instanceof HTMLInputElement) field.focus();
                        }}
                        className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800"
                      >
                        {attention.actionLabel} <ArrowRight size={15} />
                      </button>
                    ) : attention.kind === "security_check" ||
                      attention.kind === "employer_account" ? (
                      <a
                        href={job.apply_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800"
                      >
                        {attention.kind === "security_check"
                          ? "Complete employer security check"
                          : "Open employer account"}{" "}
                        <ArrowRight size={15} />
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void submitApprovedApplication()}
                        disabled={busy !== null || submissionInProgress}
                        className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                      >
                        {busy === "submit" || submissionInProgress ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : null}
                        Retry application <ArrowRight size={15} />
                      </button>
                    )}
                  </>
                ) : attention.kind === "profile_missing" ? (
                  <Link
                    href={profileCompletionHref}
                    className="ir35-focus inline-flex min-h-10 items-center rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800"
                  >
                    Complete profile
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById(
                          attention.questionIds.length
                            ? "employer-questions"
                            : "final-application-approval",
                        )
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className="ir35-focus inline-flex min-h-10 items-center rounded-xl bg-amber-700 px-4 text-sm font-bold text-white hover:bg-amber-800"
                  >
                    {attention.actionLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
      {busy === "submit" && (
        <div
          className="mt-3 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
          role="status"
        >
          <Loader2 className="mt-0.5 shrink-0 animate-spin" size={17} />
          <div>
            <p className="font-semibold">
              Application runner active · {submitElapsedSeconds}s
            </p>
            <p className="mt-1 leading-6 text-sky-900">
              Your approved Resume and answers are being completed on the employer
              form. IR35Careers will show Applied only after the employer
              returns a confirmation.
            </p>
          </div>
        </div>
      )}
      {submissionInProgress && busy !== "submit" && (
        <div
          className="mt-3 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
          role="status"
        >
          <Loader2 className="mt-0.5 shrink-0 animate-spin" size={17} />
          <div>
            <p className="font-semibold">Application processing securely</p>
            <p className="mt-1 leading-6 text-sky-900">
              You can leave this page. The status updates automatically when the
              employer confirms submission or asks for information.
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0 space-y-5">
          {!application ? (
            <section className="ir35-card overflow-hidden">
              <div className="p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                      <FileText size={20} />
                    </span>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">Resume</p>
                      <h2 className="mt-1 text-lg font-semibold text-slate-950">
                        {cvReady ? "Your Resume is ready" : "Add your Resume to continue"}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {cvReady
                          ? "We will use your saved Resume and profile for this application."
                          : "Upload a PDF or Word document once. We will read it and prepare the application."}
                      </p>
                    </div>
                  </div>
                  {cvReady && !showResumeEditor && (
                    <span className="inline-flex min-h-8 items-center self-start rounded-full bg-emerald-50 px-3 text-xs font-bold text-emerald-700">Ready</span>
                  )}
                </div>

                {cvReady && !showResumeEditor ? (
                  <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm"><FileText size={18} /></span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950">{workspace.profile.fullName.trim() ? `${workspace.profile.fullName.trim()} Resume` : "Saved Resume"}</p>
                          <p className="mt-1 text-xs text-slate-600">Selected from your profile</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => setShowResumeEditor(true)} className="ir35-focus min-h-10 rounded-xl border border-emerald-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-emerald-50">Use a different Resume</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                    <label className="ir35-focus flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-4 text-center hover:border-brand-400 hover:bg-brand-50/40">
                      <input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={parseCvFile} className="sr-only" />
                      {busy === "parse" ? <Loader2 size={22} className="animate-spin text-brand-700" /> : <Upload size={22} className="text-brand-700" />}
                      <span className="mt-2 text-sm font-bold text-slate-900">{busy === "parse" ? "Reading your Resume" : "Choose Resume file"}</span>
                      <span className="mt-1 text-xs text-slate-500">PDF, DOCX or text, up to 5MB</span>
                    </label>
                    <details className="group mt-3 rounded-xl border border-slate-200 bg-white">
                      <summary className="ir35-focus flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-slate-700">Paste Resume text instead <ChevronDown size={16} className="transition-transform group-open:rotate-180" /></summary>
                      <div className="border-t border-slate-200 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <label htmlFor="application-cv" className="text-sm font-semibold text-slate-900">Resume text</label>
                          {showDemoTools && (
                            <button type="button" onClick={() => { setCvText(SAMPLE_CV_TEXT); setCvFilename("Application Resume"); }} className="text-xs font-semibold text-brand-700">Load sample</button>
                          )}
                        </div>
                        <textarea id="application-cv" value={cvText} onChange={(event) => setCvText(event.target.value)} rows={10} maxLength={80_000} placeholder="Paste your Resume here" className="ir35-focus mt-2 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-800" />
                      </div>
                    </details>
                    {cvReady && (
                      <button type="button" onClick={() => setShowResumeEditor(false)} className="ir35-focus mt-3 min-h-10 text-sm font-semibold text-slate-600 hover:text-slate-950">Keep saved Resume</button>
                    )}
                  </div>
                )}

                <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-5 text-slate-500">
                    You will review the Resume and answers before anything is sent.
                  </p>
                  <button type="button" onClick={() => void prepare()} disabled={!cvReady || !profileReadiness.complete || busy !== null} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
                    {busy === "prepare" ? <Loader2 className="animate-spin" size={17} /> : <ArrowRight size={17} />}
                    Prepare application
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="ir35-card p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">
                      Step 2 · Role match
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                      {application.matchScore}% role match
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      We compared the role with the experience and skills in your Resume.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setApplication(null);
                      setAiResult(null);
                      setSelectedSuggestionIds([]);
                    }}
                    className="ir35-focus inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700"
                  >
                    <RotateCcw size={14} /> Change Resume
                  </button>
                </div>
                <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50">
                  <summary className="ir35-focus cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">View match details</summary>
                  <div className="grid gap-4 border-t border-slate-200 p-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                      Evidence found
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {application.matchedKeywords.length ? (
                        application.matchedKeywords.map((term) => (
                          <span
                            key={term}
                            className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-emerald-900"
                          >
                            {term}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-emerald-900">
                          No strong keyword matches yet.
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
                      Missing keywords, not assumed
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {application.missingKeywords.length ? (
                        application.missingKeywords.map((term) => (
                          <span
                            key={term}
                            className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-amber-950"
                          >
                            {term}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-amber-950">
                          No material gaps detected.
                        </span>
                      )}
                    </div>
                  </div>
                  </div>
                </details>
              </section>

              <section className="ir35-card overflow-hidden">
                <div className="border-b border-slate-200 p-5 sm:p-6">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                      <Sparkles size={19} />
                    </span>
                    <div>
                      <h2 className="font-semibold text-slate-950">
                        Improve your Resume for this role
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        Review every suggested change before it is used.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-5 sm:p-6">
                  <button
                    type="button"
                    onClick={runAiTailoring}
                    disabled={busy !== null}
                    className="ir35-focus inline-flex min-h-12 min-w-48 items-center justify-center gap-2 rounded-xl bg-violet-700 px-5 text-sm font-bold text-white hover:bg-violet-800 disabled:cursor-wait disabled:opacity-80"
                  >
                    {busy === "ai" ? (
                      <Loader2 className="animate-spin" size={17} />
                    ) : (
                      <Sparkles size={17} />
                    )}{" "}
                    {busy === "ai"
                      ? tailoringElapsedSeconds < 3
                        ? "Checking Resume evidence"
                        : tailoringElapsedSeconds < 9
                          ? `Matching the role ${tailoringElapsedSeconds}s`
                          : `Finishing safely ${tailoringElapsedSeconds}s`
                      : aiResult ? "Improve tailoring" : "Tailor my Resume"}
                  </button>
                  {busy === "ai" && (
                    <div
                      className="mt-3 max-w-md"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="h-1.5 overflow-hidden rounded-full bg-violet-100">
                        <div
                          className="h-full rounded-full bg-violet-600 transition-[width] duration-700"
                          style={{
                            width: `${Math.min(92, 18 + tailoringElapsedSeconds * 6)}%`,
                          }}
                        />
                      </div>
                      <p className="mt-2 text-xs leading-5 text-violet-800">
                        Your first evidence match is already available below.
                        The wording review will finish automatically.
                      </p>
                    </div>
                  )}
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Suggestions only use experience already supported by your Resume.{" "}
                    <Link
                      href="/ai-disclosure"
                      target="_blank"
                      className="font-semibold text-brand-700 underline"
                    >
                      How tailoring works
                    </Link>
                  </p>

                  {aiResult && (
                    <div className="mt-6 border-t border-slate-200 pt-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-violet-700">
                            Compare before approving
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-slate-950">
                            {aiResult.suggestions.length} suggested edits
                          </h3>
                          <p className="mt-1 text-sm text-slate-600">
                            Selected preview: {application.matchScore}% →{" "}
                            {selectedScore}%
                          </p>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={useAiCoverLetter}
                            onChange={(event) =>
                              setUseAiCoverLetter(event.target.checked)
                            }
                            className="h-5 w-5 accent-violet-700"
                          />{" "}
                          Use AI cover-letter draft
                        </label>
                      </div>
                      <div className="mt-4 space-y-3">
                        {aiResult.suggestions.map((suggestion) => {
                          const selected = selectedSuggestionIds.includes(
                            suggestion.id,
                          );
                          return (
                            <article
                              key={suggestion.id}
                              className={`rounded-2xl border p-4 ${selected ? "border-violet-300 bg-violet-50/40" : "border-slate-200"}`}
                            >
                              <label className="flex cursor-pointer items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(event) =>
                                    setSelectedSuggestionIds((current) =>
                                      event.target.checked
                                        ? [...current, suggestion.id]
                                        : current.filter(
                                            (id) => id !== suggestion.id,
                                          ),
                                    )
                                  }
                                  className="mt-0.5 h-5 w-5 accent-violet-700"
                                />
                                <span>
                                  <strong className="text-sm text-slate-950">
                                    {suggestion.section}
                                  </strong>
                                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                                    {suggestion.impact} impact
                                  </span>
                                  <span className="mt-1 block text-xs leading-5 text-slate-600">
                                    {suggestion.rationale}
                                  </span>
                                </span>
                              </label>
                              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                                <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">
                                    Current
                                  </p>
                                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700">
                                    {suggestion.original}
                                  </p>
                                </div>
                                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                                    Suggested
                                  </p>
                                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-800">
                                    {suggestion.replacement}
                                  </p>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={applySelectedEdits}
                        disabled={selectedSuggestions.length === 0}
                        className="ir35-focus mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-40"
                      >
                        <Check size={16} /> Apply selected edits
                      </button>
                    </div>
                  )}
                </div>
              </section>

              <section className="ir35-card p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">
                      Your final materials
                    </p>
                    <h2 className="mt-1 font-semibold text-slate-950">
                      Review your final Resume and cover letter
                    </h2>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    Editable
                  </span>
                </div>
                <label className="mt-5 block text-sm font-semibold text-slate-900">
                  Resume
                  <textarea
                    value={application.tailoredCvText}
                    onChange={(event) =>
                      updateApplication((current) => ({
                        ...current,
                        tailoredCvText: event.target.value,
                        status: "needs_review",
                        truthApproved: false,
                        materialsApproved: false,
                        submissionApproved: false,
                      }))
                    }
                    onBlur={recalculateEditedCv}
                    rows={14}
                    className="ir35-focus mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-slate-50 p-4 font-mono text-sm font-normal leading-6"
                  />
                </label>
                <label className="mt-5 block text-sm font-semibold text-slate-900">
                  Cover letter
                  <textarea
                    value={application.coverLetter}
                    onChange={(event) =>
                      updateApplication((current) => ({
                        ...current,
                        coverLetter: event.target.value,
                        status: "needs_review",
                        materialsApproved: false,
                        submissionApproved: false,
                      }))
                    }
                    rows={9}
                    className="ir35-focus mt-2 w-full resize-y rounded-2xl border border-slate-300 bg-slate-50 p-4 text-sm font-normal leading-6"
                  />
                </label>
              </section>

              <details
                id="employer-questions"
                open
                className="ir35-card group scroll-mt-24"
              >
                <summary className="ir35-focus flex cursor-pointer list-none items-center justify-between gap-3 p-5 sm:p-6">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">
                      Candidate facts
                    </p>
                    <h2 className="mt-1 font-semibold text-slate-950">
                      Review required answers
                    </h2>
                  </div>
                  <ChevronDown
                    className="transition-transform group-open:rotate-180"
                    size={19}
                  />
                </summary>
                <div className="border-t border-slate-200 p-5 sm:p-6">
                  <p className="text-sm leading-6 text-slate-600">
                    Confirm the essential answers for this application.
                    IR35Careers also keeps a broader answer bank ready for
                    common ATS forms and pauses when an employer asks something
                    new.
                  </p>
                  <div className="mt-4 space-y-3">
                    {requiredQuestions.map((question) => (
                      <div
                        key={question.id}
                        id={`question-card-${question.id}`}
                        className={`rounded-2xl border p-4 ${attention?.questionIds.includes(question.id) ? "border-amber-400 bg-amber-100 ring-2 ring-amber-200" : question.reviewed ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}
                      >
                        <label
                          htmlFor={`question-${question.id}`}
                          className="text-sm font-semibold text-slate-950"
                        >
                          {question.label}
                        </label>
                        {attention?.questionIds.includes(question.id) && (
                          <p className="mt-2 inline-flex rounded-full bg-amber-200 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-amber-900">
                            Employer answer needed
                          </p>
                        )}
                        <input
                          id={`question-${question.id}`}
                          value={question.answer}
                          onChange={(event) =>
                            updateApplication((current) => ({
                              ...current,
                              questions: current.questions.map((item) =>
                                item.id === question.id
                                  ? {
                                      ...item,
                                      answer: event.target.value,
                                      reviewed: false,
                                    }
                                  : item,
                              ),
                              status: "needs_review",
                              submissionApproved: false,
                            }))
                          }
                          className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                        />
                        <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={question.reviewed}
                            onChange={(event) =>
                              updateApplication((current) => ({
                                ...current,
                                questions: current.questions.map((item) =>
                                  item.id === question.id
                                    ? {
                                        ...item,
                                        reviewed: event.target.checked,
                                      }
                                    : item,
                                ),
                                status: "needs_review",
                                submissionApproved: false,
                              }))
                            }
                            className="h-5 w-5 accent-emerald-700"
                          />{" "}
                          I confirm this answer is accurate
                        </label>
                      </div>
                    ))}
                  </div>
                  {reusableQuestions.length > 0 && (
                    <details className="group mt-4 rounded-2xl border border-slate-200 bg-slate-50">
                      <summary className="ir35-focus flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-slate-800">
                        Reusable ATS answer bank{" "}
                        <span className="flex items-center gap-2 text-xs text-slate-500">
                          {reusableQuestions.length} answers{" "}
                          <ChevronDown
                            className="transition-transform group-open:rotate-180"
                            size={16}
                          />
                        </span>
                      </summary>
                      <div className="space-y-3 border-t border-slate-200 p-4">
                        {reusableQuestions.map((question) => (
                          <div
                            key={question.id}
                            className={`rounded-xl border bg-white p-4 ${question.reviewed ? "border-emerald-200" : "border-slate-200"}`}
                          >
                            <label
                              htmlFor={`question-${question.id}`}
                              className="text-sm font-semibold text-slate-950"
                            >
                              {question.label}
                            </label>
                            <input
                              id={`question-${question.id}`}
                              value={question.answer}
                              onChange={(event) =>
                                updateApplication((current) => ({
                                  ...current,
                                  questions: current.questions.map((item) =>
                                    item.id === question.id
                                      ? {
                                          ...item,
                                          answer: event.target.value,
                                          reviewed: false,
                                        }
                                      : item,
                                  ),
                                  status: "needs_review",
                                  submissionApproved: false,
                                }))
                              }
                              className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
                            />
                            <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={question.reviewed}
                                onChange={(event) =>
                                  updateApplication((current) => ({
                                    ...current,
                                    questions: current.questions.map((item) =>
                                      item.id === question.id
                                        ? {
                                            ...item,
                                            reviewed: event.target.checked,
                                          }
                                        : item,
                                    ),
                                    status: "needs_review",
                                    submissionApproved: false,
                                  }))
                                }
                                className="h-5 w-5 accent-emerald-700"
                              />{" "}
                              Confirm for future applications
                            </label>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </details>

              <section
                id="final-application-approval"
                className="scroll-mt-24 rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-floating sm:p-6"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-emerald-300">
                    <ShieldCheck size={19} />
                  </span>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                      Step 3
                    </p>
                    <h2 className="font-semibold">Ready to apply?</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      Confirm the final application once, then IR35Careers
                      handles the supported employer form in the background.
                    </p>
                  </div>
                </div>
                {!submitted && (
                  <label
                    className={`mt-5 flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm ${approvalsComplete ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/15 bg-white/5"}`}
                  >
                    <input
                      type="checkbox"
                      checked={approvalsComplete}
                      onChange={(event) =>
                        updateApplication((current) => ({
                          ...current,
                          truthApproved: event.target.checked,
                          materialsApproved: event.target.checked,
                          submissionApproved: event.target.checked,
                          status: "needs_review",
                        }))
                      }
                      className="h-5 w-5 accent-emerald-400"
                    />
                    I confirm this application is accurate and authorise
                    IR35Careers to complete and submit it, including ordinary
                    employer account and email-verification steps.
                  </label>
                )}
                {!submitted && (
                  <p className="mt-3 text-xs leading-5 text-slate-300">
                    {!answersReviewed
                      ? "Confirm every required answer before applying."
                      : !approvalsComplete
                        ? "Tick the final approval above to continue."
                        : submissionConnection === "gated"
                          ? "Sign in to submit this application."
                          : "Ready. IR35Careers will submit the approved materials and wait for employer confirmation."}
                  </p>
                )}
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  {submitted ? (
                    <span className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-emerald-400/15 px-4 text-sm font-bold text-emerald-200">
                      <CheckCircle2 size={17} /> Application submitted
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void submitApprovedApplication()}
                        disabled={
                          busy !== null ||
                          submissionInProgress ||
                          submissionConnection !== "connected"
                        }
                        className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-6 text-sm font-bold text-emerald-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === "submit" || submissionInProgress ? (
                          <Loader2 className="animate-spin" size={16} />
                        ) : (
                          <Send size={16} />
                        )}{" "}
                        {submissionInProgress
                          ? "Processing application"
                          : busy === "submit"
                            ? `Starting ${submitElapsedSeconds}s`
                            : "Approve and apply now"}
                      </button>
                      {submissionConnection === "gated" && (
                        <button
                          type="button"
                          onClick={() => void saveReviewedPacket()}
                          disabled={
                            busy !== null ||
                            !answersReviewed ||
                            !approvalsComplete
                          }
                          className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-slate-950 hover:bg-slate-100 disabled:opacity-40"
                        >
                          {busy === "save" ? (
                            <Loader2 className="animate-spin" size={16} />
                          ) : (
                            <Save size={16} />
                          )}{" "}
                          Save application
                        </button>
                      )}
                    </>
                  )}
                </div>
              </section>

              {submitted && application.receipt && (
                <section
                  className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6"
                  data-testid="application-receipt"
                >
                  <CheckCircle2 className="text-emerald-700" size={24} />
                  <h2 className="mt-3 font-semibold text-emerald-950">
                    Employer submission confirmed
                  </h2>
                  <p className="mt-1 font-mono text-xs text-emerald-800">
                    Receipt {application.receipt.receiptId}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-emerald-900">
                    {application.receipt.message}
                  </p>
                </section>
              )}
            </>
          )}
        </main>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:h-max">
          <section
            className={`rounded-3xl border p-5 ${submissionConnection === "connected" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}
          >
            <p
              className={`text-[10px] font-bold uppercase tracking-[0.16em] ${submissionConnection === "connected" ? "text-emerald-700" : "text-slate-500"}`}
            >
              Application status
            </p>
            <h2 className="mt-2 font-semibold text-slate-950">
              {submissionInProgress
                ? "Processing application"
                : submissionConnection === "connected"
                  ? "Ready to apply"
                  : "Sign in to apply"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {submissionInProgress
                ? "IR35Careers is completing the approved employer form. You can leave this page."
                : submissionConnection === "connected"
                  ? "Review the final materials, confirm the application and apply from this page."
                  : "Your work is safe. Sign in before sending it to the employer."}
            </p>
            {!submitted && (
              <a
                href="#final-application-approval"
                className="ir35-focus mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800"
              >
                <Send size={15} /> Go to final check
              </a>
            )}
          </section>
          <section className="ir35-card p-5">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Readiness
                </p>
                <h2 className="mt-1 text-sm font-semibold text-slate-950">
                  Application checklist
                </h2>
              </div>
              <strong className="text-2xl text-slate-950">{progress}%</strong>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-600"
                style={{ width: `${progress}%` }}
              />
            </div>
            <ul className="mt-5 space-y-3 text-sm">
              {[
                ["Resume supplied", cvReady],
                ["Role match complete", Boolean(application)],
                ["Answers confirmed", answersReviewed],
                ["Final approval complete", approvalsComplete],
              ].map(([label, done]) => (
                <li key={String(label)} className="flex items-center gap-2.5">
                  {done ? (
                    <CheckCircle2 size={17} className="text-emerald-600" />
                  ) : (
                    <span className="h-[17px] w-[17px] rounded-full border border-slate-300" />
                  )}
                  <span
                    className={
                      done ? "font-medium text-slate-800" : "text-slate-500"
                    }
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="ir35-card p-5">
            <div className="flex items-center gap-2 text-brand-700">
              <LockKeyhole size={16} />
              <p className="text-[10px] font-bold uppercase tracking-[0.16em]">
                You stay in control
              </p>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              If an employer asks a new legal, identity or personal question,
              the application pauses and asks you. Submitted applications
              include a confirmation.
            </p>
          </section>
        </aside>
      </div>
      {profilePrompt && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="complete-profile-title"
            className="w-full max-w-lg rounded-3xl bg-white p-6 text-center shadow-2xl sm:p-8"
          >
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
              <AlertTriangle size={24} />
            </span>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.15em] text-amber-700">
              Application paused
            </p>
            <h2
              id="complete-profile-title"
              className="mt-2 text-2xl font-semibold text-slate-950"
            >
              Complete your profile
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Complete the highlighted reusable answers, then return here and
              apply again. Your Resume and application are already saved.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => setProfilePrompt(false)}
                className="ir35-focus min-h-11 rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700"
              >
                Not now
              </button>
              <Link
                href={profileCompletionHref}
                className="ir35-focus inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800"
              >
                Complete profile
              </Link>
            </div>
          </section>
        </div>
      )}
      {applicationProgressDialog}
    </WorkspacePage>
  );
}
