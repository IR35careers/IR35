"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CloudDownload,
  Database,
  ExternalLink,
  FileCheck2,
  Gauge,
  Home,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Monitor,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Trash2,
  UserRound,
  Users,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { SystemMapPanel, type RunnerTestResult } from "@/components/admin/SystemMapPanel";
import { useAuth } from "@/lib/auth-context";
import { isAdministratorEmail } from "@/lib/portal-access";
import type { CampaignAudience, EmailCampaignDraft, EmailCampaignTemplate } from "@/lib/email/campaigns";
import type { IntegrationStatus } from "@/lib/integration-status";
import { supabase } from "@/lib/supabase";

type Section = "stats" | "analytics" | "jobs" | "sources" | "users" | "campaigns" | "waitlist" | "runs" | "system";

type JobRow = {
  id: string;
  title: string;
  company_name: string | null;
  location?: string | null;
  ir35_status: string | null;
  rate_min?: number | null;
  rate_max?: number | null;
  rate_type?: string | null;
  source_domain: string | null;
  posted_at?: string | null;
  first_seen_at: string;
  expired_at?: string | null;
};

type UserRow = {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string | null;
  provider?: string;
  profile?: {
    full_name?: string | null;
    skills?: string[] | null;
    cv_filename?: string | null;
  } | null;
};

type RunRow = {
  run_type: string;
  summary: Record<string, unknown> | null;
  created_at: string;
};

type JobSourceRow = {
  id: string;
  name: string;
  type: "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters";
  slug: string;
  enabled: boolean;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
  directApplyConnected?: boolean;
  directApplyEmail?: string | null;
  directApplyVerifiedAt?: string | null;
};

type PendingEmployerConnection = {
  id: string;
  requestLogId: string;
  sourceId: string;
  sourceName: string;
  email: string;
  confirmedAt: string;
};

type WaitlistRow = {
  id: string;
  email: string;
  created_at: string;
  launch_notified_at?: string | null;
  launch_email_id?: string | null;
  launch_email_attempts?: number | null;
  launch_last_error?: string | null;
};

type CampaignHistoryRow = {
  id: string;
  created_at: string;
  summary: {
    action?: string;
    subject?: string;
    audience?: CampaignAudience;
    recipient_count?: number;
    sent?: number;
    failed?: number;
    status?: string;
  } | null;
};

type AnalyticsData = {
  totalUsers: number;
  activeUsers7d: number;
  newUsers30d: number;
  profiles: number;
  cvsUploaded: number;
  savedJobs: number;
  alerts: number;
  resumeVersions: number;
  applicationPackets: number;
  submissions: number;
  inboxMessages: number;
  signupSeries: Array<{ date: string; label: string; count: number }>;
  applicationStages: Record<string, number>;
  submissionStages: Record<string, number>;
  campaignsSent: number;
  campaignAccepted: number;
  campaignFailed: number;
};

type AdminData = {
  totalUsers?: number | null;
  profiles?: number;
  cvsUploaded?: number;
  waitlist?: WaitlistRow[] | number;
  liveJobs?: number;
  expiredJobs?: number;
  ir35Breakdown?: { outside?: number; inside?: number; tbc?: number };
  topSources?: Array<{ source: string; count: number }>;
  recentJobs?: JobRow[];
  recentUsers?: UserRow[];
  recentRuns?: RunRow[];
  lastPipelineRun?: RunRow | null;
  users?: UserRow[];
  total?: number;
  jobs?: JobRow[];
  runs?: RunRow[];
  emailTemplates?: EmailCampaignTemplate[];
  audienceCounts?: Record<CampaignAudience, number>;
  campaignHistory?: CampaignHistoryRow[];
  sender?: string | null;
  deliveryConfigured?: boolean;
  analytics?: AnalyticsData;
  jobSources?: JobSourceRow[];
  sourceProviders?: JobSourceRow["type"][];
  pendingEmployerConnections?: PendingEmployerConnection[];
  integrations?: IntegrationStatus[];
  systemGeneratedAt?: string;
};

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ id: Section; label: string; icon: typeof Users }>;
}> = [
  {
    label: "Workspace",
    items: [
      { id: "stats", label: "Dashboard", icon: LayoutDashboard },
      { id: "analytics", label: "Analytics", icon: BarChart3 },
      { id: "jobs", label: "Job inventory", icon: BriefcaseBusiness },
      { id: "sources", label: "Free job sources", icon: CloudDownload },
      { id: "users", label: "Contractors", icon: Users },
    ],
  },
  {
    label: "Communications",
    items: [
      { id: "campaigns", label: "Email campaigns", icon: Send },
      { id: "waitlist", label: "Beta audience", icon: Mail },
    ],
  },
  {
    label: "System",
    items: [
      { id: "system", label: "System map", icon: Workflow },
      { id: "runs", label: "Pipeline runs", icon: Activity },
    ],
  },
];

const SECTION_COPY: Record<Section, { eyebrow: string; title: string; description: string }> = {
  stats: {
    eyebrow: "Operations centre",
    title: "Business dashboard",
    description: "Monitor contractor growth, job quality and the health of your ingestion pipeline.",
  },
  analytics: {
    eyebrow: "Growth intelligence",
    title: "Product analytics",
    description: "Understand acquisition, activation, application progress and campaign delivery without exposing personal data.",
  },
  jobs: {
    eyebrow: "Content operations",
    title: "Job inventory",
    description: "Review the latest roles, IR35 coverage and listings that need moderation.",
  },
  sources: {
    eyebrow: "Free discovery network",
    title: "Public ATS sources",
    description: "Add and verify employer career boards that publish jobs through free public ATS endpoints.",
  },
  users: {
    eyebrow: "Audience",
    title: "Contractors",
    description: "Understand registrations, profile readiness and CV adoption.",
  },
  waitlist: {
    eyebrow: "One-time notice",
    title: "Beta audience",
    description: "Review the former waitlist retained only for the approved public-access announcement.",
  },
  campaigns: {
    eyebrow: "Communications",
    title: "Email campaigns",
    description: "Create, preview, test and send professional branded service emails from one secure workspace.",
  },
  runs: {
    eyebrow: "System health",
    title: "Pipeline runs",
    description: "Inspect recent ingestion and moderation activity across the platform.",
  },
  system: {
    eyebrow: "System intelligence",
    title: "Platform connection map",
    description: "Inspect the complete user journey, live integrations, failure points and recovery actions from one view.",
  },
};

async function adminFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  return fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  });
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? new Intl.NumberFormat("en-GB").format(value) : "Not available";
}

function formatDate(value?: string | null, includeTime = false) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-GB", includeTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" }
  ).format(date);
}

function timeAgo(value?: string | null) {
  if (!value) return "No activity yet";
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(difference / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : formatDate(value);
}

function formatRate(job: JobRow) {
  if (!job.rate_min && !job.rate_max) return "Rate not shown";
  const suffix = job.rate_type === "day" ? "/day" : job.rate_type === "hour" ? "/hr" : job.rate_type ? `/${job.rate_type}` : "";
  const formatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
  if (job.rate_min && job.rate_max && job.rate_min !== job.rate_max) {
    return `${formatter.format(job.rate_min)} - ${formatter.format(job.rate_max)}${suffix}`;
  }
  return `${formatter.format(job.rate_max ?? job.rate_min ?? 0)}${suffix}`;
}

function statusTone(status?: string | null) {
  const value = (status ?? "TBC").toLowerCase();
  if (value.includes("outside")) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value.includes("inside")) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Database size={19} />
      </span>
      <p className="mt-4 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function AdminPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const campaignDraftHydrated = useRef(false);
  const [section, setSection] = useState<Section>("stats");
  const [data, setData] = useState<AdminData | null>(null);
  const [busy, setBusy] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expiringId, setExpiringId] = useState<string | null>(null);
  const [sendingLaunch, setSendingLaunch] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailCampaignDraft | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [campaignAudience, setCampaignAudience] = useState<CampaignAudience>("registered");
  const [customRecipient, setCustomRecipient] = useState("");
  const [emailPreview, setEmailPreview] = useState("");
  const [previewingEmail, setPreviewingEmail] = useState(false);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [sendingCampaign, setSendingCampaign] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [sourceType, setSourceType] = useState<JobSourceRow["type"]>("greenhouse");
  const [sourceSlug, setSourceSlug] = useState("");
  const [savingSource, setSavingSource] = useState(false);
  const [sourceActionId, setSourceActionId] = useState<string | null>(null);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [destinationSourceId, setDestinationSourceId] = useState("");
  const [recruitmentEmail, setRecruitmentEmail] = useState("");
  const [sendingDestinationVerification, setSendingDestinationVerification] = useState(false);
  const [reviewingConnectionId, setReviewingConnectionId] = useState<string | null>(null);
  const [testingRunner, setTestingRunner] = useState(false);
  const [runnerTestResult, setRunnerTestResult] = useState<RunnerTestResult | null>(null);
  const [recoveringSubmissions, setRecoveringSubmissions] = useState(false);

  const load = useCallback(async (target: Section) => {
    setBusy(true);
    setError(null);
    try {
      const response = await adminFetch(`/api/admin?section=${target}`);
      if (response.status === 401) {
        setSessionReady(false);
        return;
      }
      if (response.status === 403) {
        setForbidden(true);
        return;
      }
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to load admin data");
      setData(json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load admin data");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && user && sessionReady) load(section);
    if (!loading && !user) {
      setBusy(false);
      router.replace("/login");
    }
    if (!loading && user && !isAdministratorEmail(user.email)) {
      setBusy(false);
      setForbidden(true);
    }
  }, [user, loading, section, load, router, sessionReady]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (section !== "campaigns" || !data?.emailTemplates?.length || campaignDraftHydrated.current) return;
    campaignDraftHydrated.current = true;
    try {
      const stored = window.localStorage.getItem("ir35careers-admin-email-draft");
      if (stored) {
        const saved = JSON.parse(stored) as { draft?: EmailCampaignDraft; campaignId?: string; audience?: CampaignAudience; customRecipient?: string };
        if (saved.draft?.subject && saved.draft?.message && saved.campaignId) {
          setEmailDraft(saved.draft);
          setCampaignId(saved.campaignId);
          if (["registered", "registered_with_cv", "registered_without_cv", "inactive_30d", "waitlist", "all", "custom"].includes(saved.audience ?? "")) setCampaignAudience(saved.audience as CampaignAudience);
          setCustomRecipient(saved.customRecipient ?? "");
          setDraftSavedAt(new Date().toISOString());
          return;
        }
      }
    } catch {
      window.localStorage.removeItem("ir35careers-admin-email-draft");
    }
    const first = data.emailTemplates[0];
    setEmailDraft({
      templateId: first.templateId,
      subject: first.subject,
      preheader: first.preheader,
      eyebrow: first.eyebrow,
      heading: first.heading,
      message: first.message,
      ctaLabel: first.ctaLabel,
      ctaUrl: first.ctaUrl,
    });
    setCampaignId(crypto.randomUUID());
  }, [data?.emailTemplates, section]);

  useEffect(() => {
    if (section !== "campaigns" || !emailDraft || !campaignId || !campaignDraftHydrated.current) return;
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem("ir35careers-admin-email-draft", JSON.stringify({
        draft: emailDraft,
        campaignId,
        audience: campaignAudience,
        customRecipient,
      }));
      setDraftSavedAt(new Date().toISOString());
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [campaignAudience, campaignId, customRecipient, emailDraft, section]);

  useEffect(() => {
    if (section !== "campaigns" || !emailDraft) return;
    const timeout = window.setTimeout(async () => {
      setPreviewingEmail(true);
      try {
        const response = await adminFetch("/api/admin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "preview_email_campaign", draft: emailDraft }),
        });
        const json = await response.json();
        if (response.ok) setEmailPreview(json.html ?? "");
      } finally {
        setPreviewingEmail(false);
      }
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [emailDraft, section]);

  useEffect(() => {
    if (section !== "sources" || destinationSourceId || !data?.jobSources?.length) return;
    setDestinationSourceId(data.jobSources[0].id);
  }, [data?.jobSources, destinationSourceId, section]);

  const navigate = (next: Section) => {
    setSection(next);
    setQuery("");
    setNotice(null);
    setMobileOpen(false);
  };

  const unlockAdmin = async () => {
    setUnlocking(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await response.json();
      if (response.status === 401 || response.status === 403) {
        setForbidden(true);
        return;
      }
      if (!response.ok) throw new Error(json.error ?? "Unable to unlock secure administration");
      setForbidden(false);
      setBusy(true);
      setSessionReady(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to unlock secure administration");
    } finally {
      setUnlocking(false);
    }
  };

  const lockAndSignOut = async (destination = "/") => {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => undefined);
    await signOut();
    router.replace(destination);
  };

  const expireJob = async (job: JobRow) => {
    if (!window.confirm(`Expire “${job.title}”? It will no longer appear in the live job search.`)) return;
    setExpiringId(job.id);
    setError(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "expire_job", jobId: job.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to expire this job");
      setNotice(`“${job.title}” was removed from the live inventory.`);
      await load("jobs");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to expire this job");
    } finally {
      setExpiringId(null);
    }
  };

  const saveJobSource = async () => {
    setSavingSource(true);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert_job_source",
          source: { name: sourceName, type: sourceType, slug: sourceSlug },
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to verify this public job board");
      setSourceName("");
      setSourceSlug("");
      setNotice(`${json.source?.name ?? "The source"} was verified and added. ${formatNumber(json.publishedJobsFound)} published jobs were visible on its board.`);
      await load("sources");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to verify this public job board");
    } finally {
      setSavingSource(false);
    }
  };

  const toggleJobSource = async (source: JobSourceRow) => {
    setSourceActionId(source.id);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "toggle_job_source", sourceId: source.id, enabled: !source.enabled }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to update this source");
      setNotice(`${source.name} is now ${source.enabled ? "paused" : "included in daily refreshes"}.`);
      await load("sources");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update this source");
    } finally {
      setSourceActionId(null);
    }
  };

  const removeJobSource = async (source: JobSourceRow) => {
    if (!window.confirm(`Remove ${source.name} from future free job refreshes? Existing listings remain until they expire.`)) return;
    setSourceActionId(source.id);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove_job_source", sourceId: source.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to remove this source");
      setNotice(`${source.name} was removed from future refreshes.`);
      await load("sources");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to remove this source");
    } finally {
      setSourceActionId(null);
    }
  };

  const runJobPipeline = async () => {
    setRunningPipeline(true);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run_job_pipeline" }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "The job refresh did not complete");
      setNotice(`Refresh complete. ${formatNumber(json.summary?.upserted)} jobs were updated from ${formatNumber(json.summary?.fetched)} fetched listings.`);
      await load("sources");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The job refresh did not complete");
    } finally {
      setRunningPipeline(false);
    }
  };

  const runApplicationRunnerTest = async () => {
    setTestingRunner(true);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test_application_runner" }),
      });
      const json = await response.json() as RunnerTestResult & { error?: string };
      if (response.status === 401) {
        setSessionReady(false);
        return;
      }
      if (!response.ok) throw new Error(json.error ?? "The application runner test could not start");
      setRunnerTestResult(json);
      setNotice(json.state === "submitted" ? "The controlled production application completed successfully." : "The controlled test found an application runner issue. Review the failed check below.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The application runner test failed");
    } finally {
      setTestingRunner(false);
    }
  };

  const recoverStaleSubmissions = async () => {
    setRecoveringSubmissions(true);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "recover_stale_submissions" }),
      });
      const json = await response.json() as { recovered?: number; error?: string };
      if (response.status === 401) {
        setSessionReady(false);
        return;
      }
      if (!response.ok) throw new Error(json.error ?? "Stale application attempts could not be recovered");
      const recovered = json.recovered ?? 0;
      setNotice(
        recovered > 0
          ? `${recovered} stale application attempt${recovered === 1 ? "" : "s"} recovered. Contractors can retry safely.`
          : "No stale application attempts were found.",
      );
      await load("analytics");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stale application attempts could not be recovered");
    } finally {
      setRecoveringSubmissions(false);
    }
  };

  const requestDestinationVerification = async () => {
    setSendingDestinationVerification(true);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "request_employer_destination_verification",
          sourceId: destinationSourceId,
          recruitmentEmail,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to send employer verification");
      setRecruitmentEmail("");
      setNotice(`Verification sent to ${json.email}. Direct application delivery activates only after the employer confirms the link.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send employer verification");
    } finally {
      setSendingDestinationVerification(false);
    }
  };

  const reviewEmployerConnection = async (connection: PendingEmployerConnection, approve: boolean) => {
    if (!window.confirm(`${approve ? "Approve" : "Reject"} direct application delivery for ${connection.sourceName} at ${connection.email}?`)) return;
    setReviewingConnectionId(connection.id);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: approve ? "approve_employer_connection" : "reject_employer_connection",
          connectionId: connection.id,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to review this employer connection");
      setNotice(`${connection.sourceName} application delivery was ${approve ? "approved" : "rejected"}.`);
      await load("sources");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to review this employer connection");
    } finally {
      setReviewingConnectionId(null);
    }
  };

  const sendBetaLaunch = async () => {
    if (!window.confirm("Correct the approved addresses, remove registered duplicates and invalid rows, then send the beta invitation to every remaining recipient?")) return;
    setSendingLaunch(true);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "send_beta_launch",
          confirmation: "SEND_BETA_ACCESS_2026_08_21",
        }),
      });
      const json = await response.json();
      if (response.status === 401) {
        setSessionReady(false);
        return;
      }
      if (!response.ok) throw new Error(json.error ?? "Unable to send the beta invitation");
      setNotice(`${json.sent ?? 0} beta invitation emails were accepted by the delivery provider. ${json.failed ?? 0} failed.`);
      await load("waitlist");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send the beta invitation");
    } finally {
      setSendingLaunch(false);
    }
  };

  const chooseEmailTemplate = (template: EmailCampaignTemplate) => {
    setEmailDraft({
      templateId: template.templateId,
      subject: template.subject,
      preheader: template.preheader,
      eyebrow: template.eyebrow,
      heading: template.heading,
      message: template.message,
      ctaLabel: template.ctaLabel,
      ctaUrl: template.ctaUrl,
    });
    setCampaignId(crypto.randomUUID());
    setNotice(null);
  };

  const sendCampaignTest = async () => {
    if (!emailDraft) return;
    setSendingTestEmail(true);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send_email_campaign_test", draft: emailDraft }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to send the test email");
      setNotice(`A test email was sent to ${json.recipient}.`);
      await load("campaigns");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send the test email");
    } finally {
      setSendingTestEmail(false);
    }
  };

  const sendEmailCampaign = async () => {
    if (!emailDraft || !campaignId) return;
    setSendingCampaign(true);
    setError(null);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "send_email_campaign",
          confirmation: "SEND_EMAIL_CAMPAIGN",
          campaignId,
          draft: emailDraft,
          audience: campaignAudience,
          customEmail: customRecipient,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to send the email campaign");
      setNotice(`${json.sent ?? 0} emails were accepted by the delivery provider. ${json.failed ?? 0} failed.`);
      setCampaignId(crypto.randomUUID());
      await load("campaigns");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send the email campaign");
    } finally {
      setSendingCampaign(false);
    }
  };

  const normalisedQuery = query.trim().toLowerCase();
  const jobs = (data?.jobs ?? []).filter((job) => !normalisedQuery || [job.title, job.company_name, job.location, job.source_domain, job.ir35_status]
    .some((value) => value?.toLowerCase().includes(normalisedQuery)));
  const jobSources = (data?.jobSources ?? []).filter((source) => !normalisedQuery || [source.name, source.type, source.slug]
    .some((value) => value.toLowerCase().includes(normalisedQuery)));
  const users = (data?.users ?? []).filter((account) => !normalisedQuery || [account.email, account.profile?.full_name, account.provider]
    .some((value) => value?.toLowerCase().includes(normalisedQuery)));
  const waitlist = (Array.isArray(data?.waitlist) ? data.waitlist : []).filter((entry) => !normalisedQuery || entry.email.toLowerCase().includes(normalisedQuery));
  const runs = (data?.runs ?? []).filter((run) => !normalisedQuery || run.run_type.toLowerCase().includes(normalisedQuery) || JSON.stringify(run.summary).toLowerCase().includes(normalisedQuery));

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0f17] text-slate-400">
        <div className="flex items-center gap-3 text-sm"><Loader2 className="animate-spin text-emerald-400" size={20} /> Opening admin workspace…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0f17] text-slate-400">
        <div className="flex items-center gap-3 text-sm"><Loader2 className="animate-spin text-emerald-400" size={20} /> Opening administrator sign in…</div>
      </main>
    );
  }

  if (forbidden) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0f17] px-5 py-12 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_35%)]" />
        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.055] p-7 text-center shadow-2xl backdrop-blur-xl sm:p-9">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-300">
            <ShieldAlert size={25} />
          </span>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Protected workspace</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Admin access required</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">Only approved IR35Careers administrator accounts can create a short-lived admin session.</p>
          {user ? (
            <button type="button" onClick={() => void lockAndSignOut("/login")} className="mt-7 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#0b0f17]">
              Try a different account <ArrowRight size={15} />
            </button>
          ) : (
            <Link href="/login" className="mt-7 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#0b0f17]">
              Continue to sign in <ArrowRight size={15} />
            </Link>
          )}
          <Link href="https://www.ir35careers.com" className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"><Home size={14} /> Back to website</Link>
        </div>
      </main>
    );
  }

  if (!sessionReady) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0f17] px-5 py-12 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_35%)]" />
        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.055] p-7 text-center shadow-2xl backdrop-blur-xl sm:p-9">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><LockKeyhole size={25} /></span>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Short-lived secure session</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Unlock administration</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">Your account will be verified on the server before a protected, HttpOnly admin session is opened for 20 minutes.</p>
          <p className="mt-5 rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3 text-xs text-slate-400"><span className="block font-semibold text-slate-200">admin.ir35careers</span><span className="mt-1 block truncate">{user?.email}</span></p>
          {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
          <button type="button" onClick={() => void unlockAdmin()} disabled={unlocking} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-70 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#0b0f17]">
            {unlocking ? <Loader2 className="animate-spin" size={16} /> : <LockKeyhole size={16} />} {unlocking ? "Verifying account…" : "Unlock for 20 minutes"}
          </button>
          <Link href="https://www.ir35careers.com" className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"><Home size={14} /> Back to website</Link>
        </div>
      </main>
    );
  }

  const current = SECTION_COPY[section];
  const sidebar = (
    <>
      <div className="flex h-20 items-center justify-between border-b border-white/[0.07] px-5">
        <Link href="/" className="flex items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-400">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-emerald-950 shadow-[0_0_28px_rgba(16,185,129,0.2)]"><BriefcaseBusiness size={20} /></span>
          <span><span className="block text-sm font-bold tracking-tight text-white">IR35Careers</span><span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">Admin workspace</span></span>
        </Link>
        <button type="button" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden" aria-label="Close admin navigation"><X size={18} /></button>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-5" aria-label="Admin navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-6">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const selected = section === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => navigate(item.id)}
                    aria-current={selected ? "page" : undefined}
                    className={`group flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${selected ? "bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]" : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100"}`}
                  >
                    <item.icon size={17} className={selected ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-300"} />
                    <span className="flex-1">{item.label}</span>
                    {selected && <ChevronRight size={14} className="text-slate-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-8 rounded-2xl border border-emerald-400/10 bg-gradient-to-br from-emerald-400/[0.1] to-cyan-400/[0.04] p-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300"><ShieldCheck size={16} /></span>
          <p className="mt-3 text-xs font-semibold text-slate-100">Private operations area</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">Every moderation action is recorded in your audit trail.</p>
        </div>
      </nav>

      <div className="border-t border-white/[0.07] p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-300"><UserRound size={16} /></span>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-white">admin.ir35careers</p><p className="truncate text-[11px] text-slate-500">{user?.email}</p></div>
          <button type="button" onClick={() => void lockAndSignOut()} className="rounded-lg p-2 text-slate-500 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400" aria-label="Lock admin and sign out"><LogOut size={15} /></button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#f5f7f9] text-slate-950">
      {mobileOpen && <button type="button" className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-white/[0.06] bg-[#0b0f17] transition-transform duration-200 lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>{sidebar}</aside>

      <div className="lg:pl-[272px]">
        <header className="sticky top-0 z-30 flex h-20 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-6 xl:px-8">
          <button type="button" onClick={() => setMobileOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 lg:hidden" aria-label="Open admin navigation"><Menu size={18} /></button>
          <div className="relative max-w-xl flex-1">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" placeholder={`Search ${section === "stats" ? "recent roles" : current.title.toLowerCase()}…`} aria-label={`Search ${current.title}`} />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:block">/</kbd>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="https://www.ir35careers.com" target="_blank" className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-950 sm:inline-flex">View website <ExternalLink size={14} /></Link>
            <button type="button" onClick={() => load(section)} disabled={busy} className="flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-70" aria-label="Refresh admin data"><RefreshCw size={14} className={busy ? "animate-spin" : ""} /><span className="hidden sm:inline">Refresh</span></button>
          </div>
        </header>

        <main className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 sm:py-8 xl:px-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">{current.eyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-[30px]">{current.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{current.description}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" /> Secure live data</div>
          </div>

          {error && <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><ShieldAlert className="mt-0.5 shrink-0" size={16} /><span className="flex-1">{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={15} /></button></div>}
          {notice && <div role="status" className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 shrink-0" size={16} /><span className="flex-1">{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button></div>}

          {busy ? (
            <div className="mt-8 grid animate-pulse gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading admin data">
              {[0, 1, 2, 3].map((item) => <div key={item} className="h-40 rounded-2xl border border-slate-200 bg-white" />)}
            </div>
          ) : section === "stats" && data ? (
            <Overview data={data} query={normalisedQuery} onNavigate={navigate} />
          ) : section === "analytics" && data?.analytics ? (
            <AnalyticsPanel analytics={data.analytics} recovering={recoveringSubmissions} onRecover={() => void recoverStaleSubmissions()} />
          ) : section === "jobs" && data ? (
            <JobsPanel jobs={jobs} total={(data.jobs ?? []).length} query={normalisedQuery} expiringId={expiringId} onExpire={expireJob} />
          ) : section === "sources" && data ? (
            <JobSourcesPanel
              sources={jobSources}
              total={(data.jobSources ?? []).length}
              providers={data.sourceProviders ?? ["greenhouse", "lever", "ashby", "workable", "smartrecruiters"]}
              lastRun={data.lastPipelineRun ?? null}
              query={normalisedQuery}
              name={sourceName}
              type={sourceType}
              slug={sourceSlug}
              saving={savingSource}
              actionId={sourceActionId}
              running={runningPipeline}
              destinationSourceId={destinationSourceId}
              recruitmentEmail={recruitmentEmail}
              sendingDestinationVerification={sendingDestinationVerification}
              pendingConnections={data.pendingEmployerConnections ?? []}
              reviewingConnectionId={reviewingConnectionId}
              onNameChange={setSourceName}
              onTypeChange={setSourceType}
              onSlugChange={setSourceSlug}
              onSave={() => void saveJobSource()}
              onToggle={(source) => void toggleJobSource(source)}
              onRemove={(source) => void removeJobSource(source)}
              onRun={() => void runJobPipeline()}
              onDestinationSourceChange={setDestinationSourceId}
              onRecruitmentEmailChange={setRecruitmentEmail}
              onRequestDestinationVerification={() => void requestDestinationVerification()}
              onReviewConnection={(connection, approve) => void reviewEmployerConnection(connection, approve)}
            />
          ) : section === "users" && data ? (
            <UsersPanel users={users} total={data.total ?? (data.users ?? []).length} query={normalisedQuery} />
          ) : section === "campaigns" && data ? (
            <EmailCampaignsPanel
              data={data}
              draft={emailDraft}
              audience={campaignAudience}
              customRecipient={customRecipient}
              previewHtml={emailPreview}
              previewing={previewingEmail}
              sendingTest={sendingTestEmail}
              sendingCampaign={sendingCampaign}
              draftSavedAt={draftSavedAt}
              query={normalisedQuery}
              onChooseTemplate={chooseEmailTemplate}
              onDraftChange={setEmailDraft}
              onAudienceChange={setCampaignAudience}
              onCustomRecipientChange={setCustomRecipient}
              onSendTest={() => void sendCampaignTest()}
              onSendCampaign={() => void sendEmailCampaign()}
            />
          ) : section === "waitlist" && data ? (
            <LaunchAudiencePanel entries={waitlist} total={Array.isArray(data.waitlist) ? data.waitlist.length : 0} query={normalisedQuery} sending={sendingLaunch} onSend={sendBetaLaunch} />
          ) : section === "runs" && data ? (
            <RunsPanel runs={runs} query={normalisedQuery} />
          ) : section === "system" && data ? (
            <SystemMapPanel integrations={data.integrations ?? []} query={normalisedQuery} testing={testingRunner} testResult={runnerTestResult} onRunTest={() => void runApplicationRunnerTest()} />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function Overview({ data, query, onNavigate }: { data: AdminData; query: string; onNavigate: (section: Section) => void }) {
  const profiles = data.profiles ?? 0;
  const cvs = data.cvsUploaded ?? 0;
  const cvReadiness = profiles > 0 ? Math.round((cvs / profiles) * 100) : 0;
  const inventory = (data.liveJobs ?? 0) + (data.expiredJobs ?? 0);
  const liveShare = inventory > 0 ? Math.round(((data.liveJobs ?? 0) / inventory) * 100) : 0;
  const breakdown = data.ir35Breakdown ?? { outside: 0, inside: 0, tbc: 0 };
  const breakdownTotal = (breakdown.outside ?? 0) + (breakdown.inside ?? 0) + (breakdown.tbc ?? 0);
  const recentJobs = (data.recentJobs ?? []).filter((job) => !query || [job.title, job.company_name, job.location, job.source_domain].some((value) => value?.toLowerCase().includes(query)));
  const latestRun = data.lastPipelineRun;

  const cards = [
    { label: "Active jobs", value: data.liveJobs, icon: BriefcaseBusiness, tone: "bg-emerald-50 text-emerald-700", detail: `${liveShare}% of total inventory is live`, badge: "Live" },
    { label: "Contractors", value: data.totalUsers, icon: Users, tone: "bg-blue-50 text-blue-700", detail: `${formatNumber(profiles)} completed profiles`, badge: "Members" },
    { label: "CV readiness", value: `${cvReadiness}%`, icon: FileCheck2, tone: "bg-violet-50 text-violet-700", detail: `${formatNumber(cvs)} of ${formatNumber(profiles)} profiles`, badge: "Adoption" },
    { label: "Beta audience", value: typeof data.waitlist === "number" ? data.waitlist : 0, icon: Mail, tone: "bg-amber-50 text-amber-700", detail: "Former opt-ins for one beta invitation", badge: "Private" },
  ];

  return (
    <div className="mt-7 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/40">
            <div className="flex items-center justify-between"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}><card.icon size={18} /></span><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">{card.badge}</span></div>
            <p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-slate-950 tabular-nums">{typeof card.value === "string" ? card.value : formatNumber(card.value)}</p>
            <p className="mt-1 text-sm font-medium text-slate-700">{card.label}</p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><TrendingUp size={13} className="text-emerald-600" /> {card.detail}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
        <Panel title="Job inventory" description="Current live sample grouped by the IR35 status shown in each listing." action={<button type="button" onClick={() => onNavigate("jobs")} className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800">Manage jobs <ArrowRight size={13} /></button>}>
          <div className="grid gap-7 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div>
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" aria-label="IR35 status distribution">
                {[{ key: "outside", color: "bg-emerald-500" }, { key: "inside", color: "bg-rose-500" }, { key: "tbc", color: "bg-amber-400" }].map(({ key, color }) => {
                  const value = breakdown[key as keyof typeof breakdown] ?? 0;
                  return <span key={key} className={color} style={{ width: `${breakdownTotal ? Math.max((value / breakdownTotal) * 100, value ? 2 : 0) : 0}%` }} />;
                })}
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[{ label: "Outside IR35", value: breakdown.outside, dot: "bg-emerald-500" }, { label: "Inside IR35", value: breakdown.inside, dot: "bg-rose-500" }, { label: "Status TBC", value: breakdown.tbc, dot: "bg-amber-400" }].map((item) => (
                  <div key={item.label} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3.5"><p className="flex items-center gap-2 text-xs text-slate-500"><span className={`h-2 w-2 rounded-full ${item.dot}`} />{item.label}</p><p className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{formatNumber(item.value)}</p></div>
                ))}
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-xs"><span className="text-slate-500">Based on the latest {formatNumber(breakdownTotal)} live roles</span><span className="font-semibold text-slate-700">{formatNumber(data.expiredJobs)} archived</span></div>
            </div>
            <div className="flex flex-col items-center rounded-2xl bg-slate-950 px-6 py-7 text-white">
              <div className="relative flex h-28 w-28 items-center justify-center rounded-full" style={{ background: `conic-gradient(#34d399 ${liveShare * 3.6}deg, #263244 0deg)` }}>
                <div className="flex h-[86px] w-[86px] flex-col items-center justify-center rounded-full bg-slate-950"><span className="text-2xl font-semibold tabular-nums">{liveShare}%</span><span className="text-[10px] uppercase tracking-wider text-slate-500">Live</span></div>
              </div>
              <p className="mt-4 text-sm font-semibold">Inventory health</p><p className="mt-1 text-center text-[11px] leading-5 text-slate-400">Live vs. archived listings across the full catalogue.</p>
            </div>
          </div>
        </Panel>

        <Panel title="Pipeline health" description="The most recent successful job-fetch activity.">
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-4 rounded-2xl bg-emerald-50 p-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white"><Zap size={19} /></span><div><p className="text-sm font-semibold text-emerald-950">{latestRun ? "Pipeline reporting" : "Waiting for first run"}</p><p className="mt-0.5 text-xs text-emerald-700">{timeAgo(latestRun?.created_at)}</p></div></div>
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Last completed</span><span className="font-medium text-slate-900">{formatDate(latestRun?.created_at, true)}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Run type</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{latestRun?.run_type?.replaceAll("_", " ") ?? "Not available"}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="text-slate-500">Audit coverage</span><span className="inline-flex items-center gap-1.5 font-medium text-emerald-700"><CheckCircle2 size={14} /> Enabled</span></div>
            </div>
            <button type="button" onClick={() => onNavigate("runs")} className="mt-6 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">View run history <ArrowRight size={13} /></button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <Panel title="Latest job activity" description="The newest live roles available to contractors." action={<span className="hidden items-center gap-1.5 text-[11px] text-slate-500 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Updating from live data</span>}>
          {recentJobs.length ? <div className="divide-y divide-slate-100">{recentJobs.map((job) => <div key={job.id} className="group flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50/80 sm:px-6"><span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 sm:flex"><BriefcaseBusiness size={16} /></span><div className="min-w-0 flex-1"><Link href={`/jobs/${job.id}`} className="block truncate text-sm font-semibold text-slate-900 hover:text-emerald-700">{job.title}</Link><p className="mt-1 truncate text-xs text-slate-500">{job.company_name || "Company not shown"} · {job.location || "UK"}</p></div><div className="hidden text-right md:block"><p className="text-xs font-semibold text-slate-700">{formatRate(job)}</p><p className="mt-1 text-[11px] text-slate-400">{timeAgo(job.first_seen_at)}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusTone(job.ir35_status)}`}>{job.ir35_status || "TBC"}</span></div>)}</div> : <EmptyState title={query ? "No matching roles" : "No recent roles"} detail={query ? "Try a broader search term." : "New roles will appear after the next successful pipeline run."} />}
        </Panel>

        <Panel title="Top sources" description="Sources contributing to the current live sample.">
          <div className="space-y-5 p-5 sm:p-6">
            {(data.topSources ?? []).length ? data.topSources?.map((source, index) => {
              const maximum = Math.max(...(data.topSources ?? []).map((item) => item.count), 1);
              return <div key={source.source}><div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate font-medium text-slate-700"><span className="mr-2 text-slate-400">{String(index + 1).padStart(2, "0")}</span>{source.source}</span><span className="font-semibold tabular-nums text-slate-900">{source.count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(source.count / maximum) * 100}%` }} /></div></div>;
            }) : <EmptyState title="No source data" detail="Source distribution will appear when live roles are available." />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AnalyticsPanel({ analytics, recovering, onRecover }: { analytics: AnalyticsData; recovering: boolean; onRecover: () => void }) {
  const cvRate = analytics.profiles > 0 ? Math.round((analytics.cvsUploaded / analytics.profiles) * 100) : 0;
  const activeRate = analytics.totalUsers > 0 ? Math.round((analytics.activeUsers7d / analytics.totalUsers) * 100) : 0;
  const submissionRate = analytics.applicationPackets > 0 ? Math.round((analytics.submissions / analytics.applicationPackets) * 100) : 0;
  const maxSignups = Math.max(...analytics.signupSeries.map((day) => day.count), 1);
  const funnel = [
    { label: "Accounts", value: analytics.totalUsers, tone: "bg-slate-950" },
    { label: "Profiles", value: analytics.profiles, tone: "bg-emerald-700" },
    { label: "CVs", value: analytics.cvsUploaded, tone: "bg-emerald-500" },
    { label: "Applications", value: analytics.applicationPackets, tone: "bg-cyan-500" },
    { label: "Submissions", value: analytics.submissions, tone: "bg-blue-500" },
  ];
  const applicationStages = Object.entries(analytics.applicationStages).sort((a, b) => b[1] - a[1]);
  const stageMax = Math.max(...applicationStages.map(([, count]) => count), 1);
  const submissionStages = Object.entries(analytics.submissionStages).sort((a, b) => b[1] - a[1]);
  const submissionStageMax = Math.max(...submissionStages.map(([, count]) => count), 1);
  const campaignTotal = analytics.campaignAccepted + analytics.campaignFailed;
  const deliveryRate = campaignTotal > 0 ? Math.round((analytics.campaignAccepted / campaignTotal) * 100) : 100;
  const cards = [
    { label: "Contractors", value: analytics.totalUsers, detail: `+${formatNumber(analytics.newUsers30d)} in the last 30 days`, icon: Users, tone: "bg-blue-50 text-blue-700" },
    { label: "Active this week", value: analytics.activeUsers7d, detail: `${activeRate}% of all accounts`, icon: Activity, tone: "bg-emerald-50 text-emerald-700" },
    { label: "CV readiness", value: `${cvRate}%`, detail: `${formatNumber(analytics.cvsUploaded)} uploaded CVs`, icon: FileCheck2, tone: "bg-violet-50 text-violet-700" },
    { label: "Submission progress", value: `${submissionRate}%`, detail: `${formatNumber(analytics.submissions)} submission records`, icon: Send, tone: "bg-amber-50 text-amber-700" },
  ];

  return (
    <div className="mt-7 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <article key={card.label} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"><div className="flex items-center justify-between"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}><card.icon size={18} /></span><TrendingUp size={16} className="text-slate-300" /></div><p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] tabular-nums text-slate-950">{typeof card.value === "number" ? formatNumber(card.value) : card.value}</p><p className="mt-1 text-xs font-semibold text-slate-800">{card.label}</p><p className="mt-2 text-xs text-slate-500">{card.detail}</p></article>)}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.85fr]">
        <Panel title="New contractor accounts" description="Daily registrations over the last 14 days" action={<span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-500">Live</span>}>
          <div className="p-5 sm:p-6">
            <div className="flex h-64 items-end gap-1.5 sm:gap-2" aria-label="Fourteen-day signup chart">
              {analytics.signupSeries.map((day) => <div key={day.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] font-semibold tabular-nums text-slate-500 opacity-0 transition group-hover:opacity-100">{day.count}</span><div className="w-full rounded-t-lg bg-gradient-to-t from-emerald-600 to-emerald-400 transition group-hover:from-emerald-700" style={{ height: `${Math.max((day.count / maxSignups) * 178, day.count ? 12 : 3)}px` }} title={`${day.label}: ${day.count} registrations`} /><span className="truncate text-[9px] text-slate-400 [writing-mode:vertical-rl] sm:[writing-mode:horizontal-tb]">{day.label}</span></div>)}
            </div>
          </div>
        </Panel>

        <Panel title="Engagement signals" description="Actions that show contractor intent">
          <dl className="divide-y divide-slate-100 px-5 sm:px-6">
            {[
              ["Saved jobs", analytics.savedJobs, "Roles contractors want to revisit"],
              ["Active alerts", analytics.alerts, "Automated role discovery"],
              ["CV versions", analytics.resumeVersions, "Prepared application documents"],
              ["Recruiter messages", analytics.inboxMessages, "Responses received in workspace"],
            ].map(([label, value, detail]) => <div key={String(label)} className="flex items-center justify-between gap-4 py-4"><div><dt className="text-sm font-semibold text-slate-900">{label}</dt><p className="mt-1 text-xs text-slate-500">{detail}</p></div><dd className="text-xl font-semibold tabular-nums text-slate-950">{formatNumber(Number(value))}</dd></div>)}
          </dl>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Panel title="Contractor activation funnel" description="From registration to a recorded employer submission">
          <div className="space-y-4 p-5 sm:p-6">
            {funnel.map((step, index) => {
              const width = analytics.totalUsers > 0 ? Math.max((step.value / analytics.totalUsers) * 100, step.value ? 8 : 1) : 1;
              const previous = index > 0 ? funnel[index - 1].value : step.value;
              const conversion = previous > 0 ? Math.round((step.value / previous) * 100) : 0;
              return <div key={step.label}><div className="mb-2 flex items-center justify-between gap-4 text-xs"><span className="font-semibold text-slate-700">{step.label}</span><span className="text-slate-500"><strong className="text-slate-950">{formatNumber(step.value)}</strong>{index > 0 ? ` · ${conversion}% from previous` : ""}</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${step.tone}`} style={{ width: `${width}%` }} /></div></div>;
            })}
          </div>
        </Panel>

        <Panel title="Application stages" description="Current packet status distribution">
          {applicationStages.length ? <div className="space-y-4 p-5 sm:p-6">{applicationStages.map(([status, count]) => <div key={status}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold capitalize text-slate-700">{status.replaceAll("_", " ")}</span><span className="font-semibold tabular-nums text-slate-950">{formatNumber(count)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-800" style={{ width: `${(count / stageMax) * 100}%` }} /></div></div>)}</div> : <EmptyState title="No application activity yet" detail="Application stages will appear as contractors prepare and submit packets." />}
        </Panel>
      </div>

      <Panel title="Submission runner health" description="Real employer submission attempts by current processing state" action={<button type="button" onClick={onRecover} disabled={recovering} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60">{recovering ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} {recovering ? "Recovering" : "Recover stale attempts"}</button>}>
        {submissionStages.length ? <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">{submissionStages.map(([status, count]) => {
          const tone = status === "succeeded" ? "bg-emerald-600" : status === "processing" || status === "queued" ? "bg-amber-500" : "bg-rose-500";
          return <div key={status} className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold capitalize text-slate-700">{status.replaceAll("_", " ")}</p><p className="text-xl font-semibold tabular-nums text-slate-950">{formatNumber(count)}</p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full ${tone}`} style={{ width: `${(count / submissionStageMax) * 100}%` }} /></div><p className="mt-3 text-[11px] leading-5 text-slate-500">{status === "succeeded" ? "Employer confirmation and receipt saved" : status === "processing" || status === "queued" ? "Runner active or awaiting bounded recovery" : "Not submitted; contractor materials remain saved"}</p></div>;
        })}</div> : <EmptyState title="No submission attempts yet" detail="Runner activity will appear after a contractor approves an application." />}
      </Panel>

      <Panel title="Communication delivery" description="Accepted and failed recipients across administrator campaigns">
        <div className="grid gap-4 p-5 sm:grid-cols-4 sm:p-6">
          <div className="rounded-2xl bg-slate-950 p-5 text-white sm:col-span-2"><p className="text-xs font-semibold text-slate-400">Provider acceptance rate</p><p className="mt-3 text-4xl font-semibold tracking-[-0.05em]">{deliveryRate}%</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${deliveryRate}%` }} /></div></div>
          {[ ["Campaigns sent", analytics.campaignsSent], ["Recipients accepted", analytics.campaignAccepted] ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-3 text-2xl font-semibold tabular-nums text-slate-950">{formatNumber(Number(value))}</p><p className="mt-2 text-[11px] text-slate-500">{label === "Campaigns sent" ? `${formatNumber(analytics.campaignFailed)} failed recipients` : "Recorded by the delivery provider"}</p></div>)}
        </div>
      </Panel>
    </div>
  );
}

function JobSourcesPanel({
  sources,
  total,
  providers,
  lastRun,
  query,
  name,
  type,
  slug,
  saving,
  actionId,
  running,
  destinationSourceId,
  recruitmentEmail,
  sendingDestinationVerification,
  pendingConnections,
  reviewingConnectionId,
  onNameChange,
  onTypeChange,
  onSlugChange,
  onSave,
  onToggle,
  onRemove,
  onRun,
  onDestinationSourceChange,
  onRecruitmentEmailChange,
  onRequestDestinationVerification,
  onReviewConnection,
}: {
  sources: JobSourceRow[];
  total: number;
  providers: JobSourceRow["type"][];
  lastRun: RunRow | null;
  query: string;
  name: string;
  type: JobSourceRow["type"];
  slug: string;
  saving: boolean;
  actionId: string | null;
  running: boolean;
  destinationSourceId: string;
  recruitmentEmail: string;
  sendingDestinationVerification: boolean;
  pendingConnections: PendingEmployerConnection[];
  reviewingConnectionId: string | null;
  onNameChange: (value: string) => void;
  onTypeChange: (value: JobSourceRow["type"]) => void;
  onSlugChange: (value: string) => void;
  onSave: () => void;
  onToggle: (source: JobSourceRow) => void;
  onRemove: (source: JobSourceRow) => void;
  onRun: () => void;
  onDestinationSourceChange: (value: string) => void;
  onRecruitmentEmailChange: (value: string) => void;
  onRequestDestinationVerification: () => void;
  onReviewConnection: (connection: PendingEmployerConnection, approve: boolean) => void;
}) {
  const enabled = sources.filter((source) => source.enabled).length;
  const custom = sources.filter((source) => !source.builtIn).length;
  const lastSummary = lastRun?.summary ?? {};
  const fetched = typeof lastSummary.fetched === "number" ? lastSummary.fetched : 0;
  const upserted = typeof lastSummary.upserted === "number" ? lastSummary.upserted : 0;
  const fieldClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100";
  const examples: Record<JobSourceRow["type"], string> = {
    greenhouse: "boards.greenhouse.io/company-name",
    lever: "jobs.lever.co/company-name",
    ashby: "jobs.ashbyhq.com/company-name",
    workable: "apply.workable.com/company-name",
    smartrecruiters: "jobs.smartrecruiters.com/company-name",
  };

  return (
    <div className="mt-7 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Configured sources</p><p className="mt-3 text-3xl font-semibold tabular-nums text-slate-950">{total}</p><p className="mt-2 text-xs text-slate-500">{enabled} currently enabled</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Custom sources</p><p className="mt-3 text-3xl font-semibold tabular-nums text-slate-950">{custom}</p><p className="mt-2 text-xs text-slate-500">Admin or employer verified boards</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Last fetch</p><p className="mt-3 text-3xl font-semibold tabular-nums text-slate-950">{formatNumber(fetched)}</p><p className="mt-2 text-xs text-slate-500">{lastRun ? formatDate(lastRun.created_at, true) : "No run recorded"}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Last database update</p><p className="mt-3 text-3xl font-semibold tabular-nums text-emerald-700">{formatNumber(upserted)}</p><p className="mt-2 text-xs text-slate-500">Fresh or updated listings</p></article>
      </div>

      <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <Panel title="Add a free public board" description="The board is checked before it is saved. Full website addresses are not accepted.">
          <div className="space-y-4 p-5 sm:p-6">
            <label className="block text-xs font-semibold text-slate-700">Employer or agency name<input value={name} maxLength={100} onChange={(event) => onNameChange(event.target.value)} className={fieldClass} placeholder="Example Recruitment" /></label>
            <label className="block text-xs font-semibold text-slate-700">Public ATS provider<select value={type} onChange={(event) => onTypeChange(event.target.value as JobSourceRow["type"])} className={fieldClass}>{providers.map((provider) => <option key={provider} value={provider}>{provider[0].toUpperCase() + provider.slice(1)}</option>)}</select></label>
            <label className="block text-xs font-semibold text-slate-700">Board identifier<input value={slug} maxLength={100} onChange={(event) => onSlugChange(event.target.value)} className={fieldClass} placeholder="company-name" /><span className="mt-1.5 block text-[11px] font-normal text-slate-500">From {examples[type]}</span></label>
            <button type="button" onClick={onSave} disabled={saving || name.trim().length < 2 || !slug.trim()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} {saving ? "Checking public board" : "Verify and add source"}</button>
            <p className="text-[11px] leading-5 text-slate-500">Only supported public ATS endpoints are used. No account password is stored.</p>
          </div>
        </Panel>

        <Panel title="Daily source registry" description={`${formatNumber(total)} public boards configured. Enabled sources run during the 7 am UK refresh.`} action={<button type="button" onClick={onRun} disabled={running || enabled === 0} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-950 px-3.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-50">{running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {running ? "Refreshing jobs" : "Run refresh now"}</button>}>
          {sources.length ? <div className="divide-y divide-slate-100">{sources.map((source) => <div key={source.id} className="flex flex-col gap-4 px-5 py-4 transition hover:bg-slate-50/70 sm:flex-row sm:items-center sm:px-6"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${source.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}><CloudDownload size={17} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-slate-900">{source.name}</p><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">{source.type}</span>{source.builtIn && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Starter</span>}</div><p className="mt-1 truncate text-xs text-slate-500">{examples[source.type].replace("company-name", source.slug)}</p></div><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => onToggle(source)} disabled={actionId === source.id} className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${source.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{actionId === source.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />} {source.enabled ? "Enabled" : "Paused"}</button>{!source.builtIn && <button type="button" onClick={() => onRemove(source)} disabled={actionId === source.id} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50" aria-label={`Remove ${source.name}`}><Trash2 size={14} /></button>}</div></div>)}</div> : <EmptyState title={query ? "No matching sources" : "No sources configured"} detail={query ? "Try an employer, provider or board identifier." : "Add a public ATS board to start free job discovery."} />}
        </Panel>
      </div>

      <Panel title="Employer connection review" description="Public boards and recruitment inboxes are confirmed first. Approve direct delivery only after the organisation and destination are credible.">
        {pendingConnections.length ? <div className="divide-y divide-slate-100">{pendingConnections.map((connection) => <div key={connection.id} className="flex flex-col gap-4 px-5 py-4 sm:px-6 lg:flex-row lg:items-center"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><ShieldCheck size={17} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-950">{connection.sourceName}</p><span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Review needed</span></div><p className="mt-1 truncate text-xs text-slate-600">{connection.email}</p><p className="mt-1 text-[11px] text-slate-400">Recruitment inbox confirmed {formatDate(connection.confirmedAt, true)}</p></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => onReviewConnection(connection, false)} disabled={reviewingConnectionId === connection.id} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"><X size={13} /> Reject</button><button type="button" onClick={() => onReviewConnection(connection, true)} disabled={reviewingConnectionId === connection.id} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{reviewingConnectionId === connection.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Approve delivery</button></div></div>)}</div> : <div className="px-5 py-6 text-sm text-slate-500 sm:px-6">No employer-confirmed connections are waiting for review.</div>}
      </Panel>

      <Panel title="Connect free direct application delivery" description="The employer confirms its recruitment address before any candidate information can be sent.">
        <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-end">
          <label className="block text-xs font-semibold text-slate-700">Public job source<select value={destinationSourceId} onChange={(event) => onDestinationSourceChange(event.target.value)} className={fieldClass}>{(sources.length ? sources : []).map((source) => <option key={source.id} value={source.id}>{source.name} · {source.type}</option>)}</select></label>
          <label className="block text-xs font-semibold text-slate-700">Employer recruitment email<input type="email" value={recruitmentEmail} maxLength={254} onChange={(event) => onRecruitmentEmailChange(event.target.value)} className={fieldClass} placeholder="recruitment@company.co.uk" /></label>
          <button type="button" onClick={onRequestDestinationVerification} disabled={sendingDestinationVerification || !destinationSourceId || !recruitmentEmail.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{sendingDestinationVerification ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {sendingDestinationVerification ? "Sending verification" : "Send verification"}</button>
        </div>
        <div className="border-t border-slate-100 px-5 py-4 sm:px-6"><div className="flex flex-wrap gap-2">{sources.filter((source) => source.directApplyConnected).map((source) => <span key={source.id} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-800"><CheckCircle2 size={13} /> {source.name}: {source.directApplyEmail}</span>)}{!sources.some((source) => source.directApplyConnected) && <span className="text-xs text-slate-500">No employer recruitment destinations have been confirmed yet.</span>}</div></div>
      </Panel>

      <Panel title="How free source coverage works" description="Published jobs are read from public employer career-board endpoints.">
        <div className="grid gap-px bg-slate-100 sm:grid-cols-3"><div className="bg-white p-5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><CloudDownload size={16} /></span><p className="mt-4 text-sm font-semibold text-slate-900">No listing fee</p><p className="mt-2 text-xs leading-5 text-slate-500">Reading published jobs from these public endpoints needs no ATS account key.</p></div><div className="bg-white p-5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><ShieldCheck size={16} /></span><p className="mt-4 text-sm font-semibold text-slate-900">Safe fixed endpoints</p><p className="mt-2 text-xs leading-5 text-slate-500">Only known ATS hosts and validated board identifiers can be saved.</p></div><div className="bg-white p-5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><Zap size={16} /></span><p className="mt-4 text-sm font-semibold text-slate-900">IR35 processing</p><p className="mt-2 text-xs leading-5 text-slate-500">Listings still pass contract, UK, status, freshness and duplicate checks before publication.</p></div></div>
      </Panel>
    </div>
  );
}

function JobsPanel({ jobs, total, query, expiringId, onExpire }: { jobs: JobRow[]; total: number; query: string; expiringId: string | null; onExpire: (job: JobRow) => void }) {
  return (
    <div className="mt-7">
      <Panel title="All recent listings" description={`${formatNumber(total)} roles loaded · newest first`} action={<span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">{formatNumber(jobs.filter((job) => !job.expired_at).length)} live</span>}>
        {jobs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left"><thead><tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><th className="px-6 py-3.5">Role</th><th className="px-4 py-3.5">IR35 status</th><th className="px-4 py-3.5">Rate</th><th className="px-4 py-3.5">Source</th><th className="px-4 py-3.5">Added</th><th className="px-6 py-3.5 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{jobs.map((job) => <tr key={job.id} className="group hover:bg-slate-50/70"><td className="px-6 py-4"><Link href={`/jobs/${job.id}`} className="block max-w-[340px] truncate text-sm font-semibold text-slate-900 hover:text-emerald-700">{job.title}</Link><p className="mt-1 max-w-[340px] truncate text-xs text-slate-500">{job.company_name || "Company not shown"} · {job.location || "Location not shown"}</p></td><td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusTone(job.ir35_status)}`}>{job.ir35_status || "TBC"}</span></td><td className="px-4 py-4 text-xs font-medium text-slate-700">{formatRate(job)}</td><td className="px-4 py-4 text-xs text-slate-500">{job.source_domain || "Unknown"}</td><td className="px-4 py-4"><p className="text-xs font-medium text-slate-700">{timeAgo(job.first_seen_at)}</p><p className="mt-1 text-[11px] text-slate-400">{formatDate(job.first_seen_at)}</p></td><td className="px-6 py-4 text-right">{job.expired_at ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Archived</span> : <button type="button" onClick={() => onExpire(job)} disabled={expiringId === job.id} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60">{expiringId === job.id ? <Loader2 size={13} className="animate-spin" /> : null} Expire</button>}</td></tr>)}</tbody></table></div> : <EmptyState title={query ? "No matching jobs" : "No jobs found"} detail={query ? "Clear the search or try a company, location or source." : "The job pipeline has not returned any listings yet."} />}
      </Panel>
    </div>
  );
}

function UsersPanel({ users, total, query }: { users: UserRow[]; total: number; query: string }) {
  const withCv = users.filter((account) => account.profile?.cv_filename).length;
  return (
    <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
      <Panel title="Contractor accounts" description={`${formatNumber(total)} registered accounts`}>
        {users.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><th className="px-6 py-3.5">Contractor</th><th className="px-4 py-3.5">Sign-in</th><th className="px-4 py-3.5">Skills</th><th className="px-4 py-3.5">CV status</th><th className="px-6 py-3.5">Joined</th></tr></thead><tbody className="divide-y divide-slate-100">{users.map((account) => <tr key={account.id} className="hover:bg-slate-50/70"><td className="px-6 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{(account.profile?.full_name || account.email || "A").charAt(0).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{account.profile?.full_name || "Name not added"}</p><p className="mt-0.5 truncate text-xs text-slate-500">{account.email || "No email"}</p></div></div></td><td className="px-4 py-4 text-xs capitalize text-slate-600">{account.provider || "email"}</td><td className="px-4 py-4 text-xs font-semibold tabular-nums text-slate-700">{account.profile?.skills?.length ?? 0}</td><td className="px-4 py-4">{account.profile?.cv_filename ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 size={14} /> Uploaded</span> : <span className="text-xs text-slate-400">Not uploaded</span>}</td><td className="px-6 py-4"><p className="text-xs text-slate-700">{formatDate(account.created_at)}</p><p className="mt-1 text-[11px] text-slate-400">{timeAgo(account.created_at)}</p></td></tr>)}</tbody></table></div> : <EmptyState title={query ? "No matching contractors" : "No contractor accounts"} detail={query ? "Try searching by name, email or sign-in provider." : "New registrations will appear here."} />}
      </Panel>
      <Panel title="Profile readiness" description="A quick adoption snapshot for the loaded accounts.">
        <div className="p-6"><div className="flex items-end justify-between"><span className="text-4xl font-semibold tracking-[-0.05em] text-slate-950">{users.length ? Math.round((withCv / users.length) * 100) : 0}%</span><FileCheck2 className="text-violet-600" size={22} /></div><p className="mt-2 text-sm font-medium text-slate-700">CV adoption</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${users.length ? (withCv / users.length) * 100 : 0}%` }} /></div><dl className="mt-6 space-y-3 border-t border-slate-100 pt-5 text-sm"><div className="flex justify-between"><dt className="text-slate-500">Loaded accounts</dt><dd className="font-semibold tabular-nums">{users.length}</dd></div><div className="flex justify-between"><dt className="text-slate-500">CV uploaded</dt><dd className="font-semibold tabular-nums">{withCv}</dd></div><div className="flex justify-between"><dt className="text-slate-500">Needs CV</dt><dd className="font-semibold tabular-nums">{Math.max(users.length - withCv, 0)}</dd></div></dl></div>
      </Panel>
    </div>
  );
}

function EmailCampaignsPanel({
  data,
  draft,
  audience,
  customRecipient,
  previewHtml,
  previewing,
  sendingTest,
  sendingCampaign,
  draftSavedAt,
  query,
  onChooseTemplate,
  onDraftChange,
  onAudienceChange,
  onCustomRecipientChange,
  onSendTest,
  onSendCampaign,
}: {
  data: AdminData;
  draft: EmailCampaignDraft | null;
  audience: CampaignAudience;
  customRecipient: string;
  previewHtml: string;
  previewing: boolean;
  sendingTest: boolean;
  sendingCampaign: boolean;
  draftSavedAt: string | null;
  query: string;
  onChooseTemplate: (template: EmailCampaignTemplate) => void;
  onDraftChange: (draft: EmailCampaignDraft) => void;
  onAudienceChange: (audience: CampaignAudience) => void;
  onCustomRecipientChange: (value: string) => void;
  onSendTest: () => void;
  onSendCampaign: () => void;
}) {
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [reviewOpen, setReviewOpen] = useState(false);
  const templates = (data.emailTemplates ?? []).filter((template) => !query || [template.name, template.description, template.subject].some((value) => value.toLowerCase().includes(query)));
  const history = (data.campaignHistory ?? []).filter((entry) => !query || JSON.stringify(entry.summary).toLowerCase().includes(query));
  const counts = data.audienceCounts ?? { registered: 0, registered_with_cv: 0, registered_without_cv: 0, inactive_30d: 0, waitlist: 0, all: 0, custom: 1 };
  const recipientCount = audience === "custom" ? 1 : counts[audience];
  const audienceLabel = audience === "registered"
    ? "Registered contractors"
    : audience === "registered_with_cv"
      ? "Contractors with a CV"
      : audience === "registered_without_cv"
        ? "Contractors without a CV"
        : audience === "inactive_30d"
          ? "Inactive for 30 days"
          : audience === "waitlist"
            ? "Former waitlist"
            : audience === "all"
              ? "All unique contacts"
              : customRecipient || "Single address";
  const qualityChecks = draft ? [
    { label: "Clear subject", passed: draft.subject.length >= 20 && draft.subject.length <= 70 },
    { label: "Useful preview text", passed: draft.preheader.length >= 30 && draft.preheader.length <= 140 },
    { label: "Focused message", passed: draft.message.length >= 80 && draft.message.length <= 1200 },
    { label: "Secure website link", passed: draft.ctaUrl.startsWith("https://www.ir35careers.com/") },
    { label: "Audience selected", passed: recipientCount > 0 && (audience !== "custom" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customRecipient)) },
  ] : [];
  const passedChecks = qualityChecks.filter((check) => check.passed).length;
  const readyToSend = Boolean(draft && data.deliveryConfigured && qualityChecks.every((check) => check.passed));
  const liveCampaigns = history.filter((entry) => entry.summary?.action === "send");
  const acceptedTotal = liveCampaigns.reduce((total, entry) => total + Number(entry.summary?.sent ?? 0), 0);
  const failedTotal = liveCampaigns.reduce((total, entry) => total + Number(entry.summary?.failed ?? 0), 0);
  const fieldClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100";
  const update = <Key extends keyof EmailCampaignDraft,>(key: Key, value: EmailCampaignDraft[Key]) => {
    if (draft) onDraftChange({ ...draft, [key]: value });
  };

  return (
    <div className="mt-7 space-y-5">
      <Panel
        title="Choose a professional template"
        description="Start with a branded layout, then edit every important part before sending."
        action={<span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${data.deliveryConfigured ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{data.deliveryConfigured ? "Email ready" : "Email not configured"}</span>}
      >
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4 sm:p-6">
          {templates.map((template) => {
            const selected = draft?.templateId === template.templateId;
            return <button key={template.templateId} type="button" onClick={() => onChooseTemplate(template)} className={`rounded-2xl border p-4 text-left transition focus:outline-none focus:ring-4 focus:ring-emerald-100 ${selected ? "border-emerald-400 bg-emerald-50/70 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"}`}><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${selected ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}><LayoutTemplate size={16} /></span><p className="mt-4 text-sm font-semibold text-slate-950">{template.name}</p><p className="mt-1.5 text-xs leading-5 text-slate-500">{template.description}</p>{selected && <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><CheckCircle2 size={13} /> Selected</span>}</button>;
          })}
          {!templates.length && <div className="sm:col-span-2 xl:col-span-4"><EmptyState title="No matching templates" detail="Clear the search to see all professional email templates." /></div>}
        </div>
      </Panel>

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(540px,0.9fr)_minmax(560px,1.1fr)]">
        <Panel title="Design your email" description="Your edits are escaped, validated and rendered inside the approved IR35Careers layout." action={draftSavedAt ? <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><CheckCircle2 size={12} className="text-emerald-600" /> Draft saved</span> : null}>
          {draft ? <div className="space-y-5 p-5 sm:p-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <label className="text-xs font-semibold text-slate-700">Audience
                  <select value={audience} onChange={(event) => onAudienceChange(event.target.value as CampaignAudience)} className={fieldClass}>
                    <option value="registered">Registered contractors ({counts.registered})</option>
                    <option value="registered_with_cv">Contractors with a CV ({counts.registered_with_cv})</option>
                    <option value="registered_without_cv">Contractors without a CV ({counts.registered_without_cv})</option>
                    <option value="inactive_30d">Inactive for 30 days ({counts.inactive_30d})</option>
                    <option value="waitlist">Former waitlist ({counts.waitlist})</option>
                    <option value="all">All unique contacts ({counts.all})</option>
                    <option value="custom">Single address</option>
                  </select>
                </label>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Recipients</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{recipientCount}</p></div>
              </div>
              {audience === "custom" && <label className="mt-4 block text-xs font-semibold text-slate-700">Recipient email<input type="email" value={customRecipient} onChange={(event) => onCustomRecipientChange(event.target.value)} className={fieldClass} placeholder="name@example.com" /></label>}
              <p className="mt-3 text-[11px] leading-5 text-slate-500">Send only service information that matches why each contact gave IR35Careers their email address.</p>
            </div>

            <label className="block text-xs font-semibold text-slate-700"><span className="flex items-center justify-between"><span>Subject</span><span className="font-normal tabular-nums text-slate-400">{draft.subject.length}/120</span></span><input value={draft.subject} maxLength={120} onChange={(event) => update("subject", event.target.value)} className={fieldClass} /></label>
            <label className="block text-xs font-semibold text-slate-700"><span className="flex items-center justify-between"><span>Inbox preview text</span><span className="font-normal tabular-nums text-slate-400">{draft.preheader.length}/180</span></span><input value={draft.preheader} maxLength={180} onChange={(event) => update("preheader", event.target.value)} className={fieldClass} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700">Section label<input value={draft.eyebrow} maxLength={60} onChange={(event) => update("eyebrow", event.target.value)} className={fieldClass} /></label>
              <label className="block text-xs font-semibold text-slate-700">Button label<input value={draft.ctaLabel} maxLength={50} onChange={(event) => update("ctaLabel", event.target.value)} className={fieldClass} /></label>
            </div>
            <label className="block text-xs font-semibold text-slate-700">Main heading<input value={draft.heading} maxLength={140} onChange={(event) => update("heading", event.target.value)} className={fieldClass} /></label>
            <label className="block text-xs font-semibold text-slate-700"><span className="flex items-center justify-between"><span>Message</span><span className="font-normal tabular-nums text-slate-400">{draft.message.length}/3000</span></span><textarea value={draft.message} maxLength={3000} rows={8} onChange={(event) => update("message", event.target.value)} className={`${fieldClass} resize-y leading-6`} /></label>
            <label className="block text-xs font-semibold text-slate-700">Button destination<input type="url" value={draft.ctaUrl} maxLength={300} onChange={(event) => update("ctaUrl", event.target.value)} className={fieldClass} /><span className="mt-1.5 block text-[11px] font-normal leading-5 text-slate-500">For safety, campaign buttons can link only to www.ir35careers.com.</span></label>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold text-slate-900">Send readiness</p><p className="mt-1 text-[11px] text-slate-500">{passedChecks} of {qualityChecks.length} recommended checks passed</p></div><span className={`flex h-11 w-11 items-center justify-center rounded-full text-xs font-bold ${readyToSend ? "bg-emerald-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{qualityChecks.length ? Math.round((passedChecks / qualityChecks.length) * 100) : 0}%</span></div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">{qualityChecks.map((check) => <div key={check.label} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium ${check.passed ? "bg-emerald-50 text-emerald-700" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}><CheckCircle2 size={13} className={check.passed ? "text-emerald-600" : "text-slate-300"} /> {check.label}</div>)}</div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-5"><button type="button" onClick={() => { const template = data.emailTemplates?.find((item) => item.templateId === draft.templateId); if (template) onChooseTemplate(template); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-900"><RotateCcw size={13} /> Reset template</button><span className="text-[11px] text-slate-400">Changes save automatically</span></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={onSendTest} disabled={sendingTest || sendingCampaign || !data.deliveryConfigured} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50">{sendingTest ? <Loader2 size={15} className="animate-spin" /> : <Inbox size={15} />} {sendingTest ? "Sending test" : "Send test to me"}</button>
              <button type="button" onClick={() => setReviewOpen(true)} disabled={sendingCampaign || sendingTest || !readyToSend} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{sendingCampaign ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {sendingCampaign ? "Sending campaign" : `Review and send to ${recipientCount}`}</button>
            </div>
            <p className="text-center text-[11px] leading-5 text-slate-500">From {data.sender || "the configured IR35Careers sender"}. A final confirmation appears before the campaign is sent.</p>
          </div> : <EmptyState title="Choose a template" detail="Select one of the professional templates to start designing your message." />}
        </Panel>

        <Panel title="Live email preview" description="This is the same responsive HTML that recipients will receive." action={<div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1"><button type="button" onClick={() => setPreviewMode("desktop")} className={`flex h-7 w-7 items-center justify-center rounded-md transition ${previewMode === "desktop" ? "bg-white text-slate-950 shadow-sm" : "text-slate-400"}`} aria-label="Desktop email preview"><Monitor size={13} /></button><button type="button" onClick={() => setPreviewMode("mobile")} className={`flex h-7 w-7 items-center justify-center rounded-md transition ${previewMode === "mobile" ? "bg-white text-slate-950 shadow-sm" : "text-slate-400"}`} aria-label="Mobile email preview"><Smartphone size={13} /></button></div>}>
          <div className="border-b border-slate-100 bg-white px-5 py-4 sm:px-6"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Mail size={17} /></span><div className="min-w-0"><p className="text-xs font-semibold text-slate-900">IR35Careers <span className="font-normal text-slate-500">&lt;hello@mail.ir35careers.com&gt;</span></p><p className="mt-1 truncate text-sm font-semibold text-slate-950">{draft?.subject || "Email subject"}</p><p className="mt-0.5 truncate text-xs text-slate-500">{draft?.preheader || "Inbox preview text"}</p></div></div></div>
          <div className="relative flex min-h-[852px] justify-center overflow-hidden bg-slate-100 p-2 sm:p-4">{previewing && <span className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] text-slate-500 shadow-sm"><Loader2 size={12} className="animate-spin" /> Updating</span>}<iframe title="Campaign email preview" sandbox="" srcDoc={previewHtml} className={`h-[820px] rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-300 ${previewMode === "mobile" ? "w-[390px] max-w-full" : "w-full"}`} /></div>
        </Panel>
      </div>

      <div className="grid gap-4 sm:grid-cols-3"><article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Live campaigns</p><p className="mt-3 text-3xl font-semibold tabular-nums text-slate-950">{liveCampaigns.length}</p></article><article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Provider accepted</p><p className="mt-3 text-3xl font-semibold tabular-nums text-emerald-700">{acceptedTotal}</p></article><article className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Failed</p><p className={`mt-3 text-3xl font-semibold tabular-nums ${failedTotal ? "text-rose-700" : "text-slate-950"}`}>{failedTotal}</p></article></div>

      <Panel title="Campaign history" description="Test sends and live campaigns are recorded in the private audit trail.">
        {history.length ? <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead><tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500"><th className="px-6 py-3.5">Email</th><th className="px-4 py-3.5">Audience</th><th className="px-4 py-3.5">Accepted</th><th className="px-4 py-3.5">Status</th><th className="px-6 py-3.5">Sent</th></tr></thead><tbody className="divide-y divide-slate-100">{history.map((entry) => { const summary = entry.summary ?? {}; const accepted = summary.sent ?? (summary.action === "test" ? 1 : 0); return <tr key={entry.id} className="hover:bg-slate-50/70"><td className="px-6 py-4"><p className="max-w-[340px] truncate text-sm font-semibold text-slate-900">{summary.subject || "Email campaign"}</p><p className="mt-1 text-xs capitalize text-slate-500">{summary.action === "test" ? "Administrator test" : "Live campaign"}</p></td><td className="px-4 py-4 text-xs capitalize text-slate-600">{summary.action === "test" ? "Administrator" : summary.audience?.replaceAll("_", " ") || "-"}</td><td className="px-4 py-4 text-xs font-semibold tabular-nums text-slate-800">{accepted} / {summary.recipient_count ?? accepted}</td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ${summary.status === "accepted" ? "bg-emerald-50 text-emerald-700" : summary.status === "failed" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{summary.status || "Recorded"}</span></td><td className="px-6 py-4 text-xs text-slate-500">{formatDate(entry.created_at, true)}</td></tr>; })}</tbody></table></div> : <EmptyState title={query ? "No matching campaigns" : "No email campaigns yet"} detail={query ? "Try a different subject or audience search." : "Send yourself a test email to begin the private campaign history."} />}
      </Panel>

      {reviewOpen && draft && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="campaign-review-title"><div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl"><div className="border-b border-slate-100 px-6 py-5"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Send size={18} /></span><h2 id="campaign-review-title" className="mt-4 text-xl font-semibold tracking-tight text-slate-950">Review before sending</h2><p className="mt-1 text-sm leading-6 text-slate-500">This sends one private copy to every unique recipient and records the provider result.</p></div><dl className="space-y-4 px-6 py-5 text-sm"><div className="grid grid-cols-[100px_1fr] gap-3"><dt className="text-slate-500">Subject</dt><dd className="font-semibold text-slate-900">{draft.subject}</dd></div><div className="grid grid-cols-[100px_1fr] gap-3"><dt className="text-slate-500">Audience</dt><dd className="font-semibold text-slate-900">{audienceLabel}</dd></div><div className="grid grid-cols-[100px_1fr] gap-3"><dt className="text-slate-500">Recipients</dt><dd className="font-semibold tabular-nums text-slate-900">{recipientCount}</dd></div><div className="grid grid-cols-[100px_1fr] gap-3"><dt className="text-slate-500">From</dt><dd className="break-all font-semibold text-slate-900">{data.sender}</dd></div></dl><div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50 px-6 py-5 sm:flex-row sm:justify-end"><button type="button" onClick={() => setReviewOpen(false)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Keep editing</button><button type="button" onClick={() => { setReviewOpen(false); onSendCampaign(); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700"><Send size={15} /> Send campaign now</button></div></div></div>}
    </div>
  );
}

function LaunchAudiencePanel({
  entries,
  total,
  query,
  sending,
  onSend,
}: {
  entries: WaitlistRow[];
  total: number;
  query: string;
  sending: boolean;
  onSend: () => void;
}) {
  const notified = entries.filter((entry) => entry.launch_notified_at).length;
  const pending = entries.filter((entry) => !entry.launch_notified_at).length;
  return (
    <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Former waitlist recipients" description={`${formatNumber(total)} permission-based sign-ups · newest first`}>
        {entries.length ? <div className="divide-y divide-slate-100">{entries.map((entry, index) => <div key={`${entry.email}-${entry.created_at}`} className="flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50/70 sm:px-6"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{entry.email}</p><p className="mt-1 text-xs text-slate-500">Joined {formatDate(entry.created_at, true)}</p></div>{entry.launch_notified_at ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"><CheckCircle2 size={13} /> Sent</span> : entry.launch_last_error ? <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">Failed</span> : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Pending</span>}</div>)}</div> : <EmptyState title={query ? "No matching recipients" : "No beta recipients"} detail={query ? "Try a different email search." : "No historical waitlist records are stored."} />}
      </Panel>
      <Panel title="Beta invitation" description={pending ? `${pending} recipients are ready` : `${notified} invitations recorded`}><div className="p-6"><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${pending ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{pending ? <Mail size={19} /> : <CheckCircle2 size={19} />}</span><p className="mt-5 text-sm font-semibold text-slate-950">Your IR35Careers beta access is ready</p><p className="mt-3 text-xs leading-5 text-slate-500">{pending ? "The approved branded invitation is ready. Sending automatically removes registered duplicates and invalid placeholder addresses, then records every provider delivery ID." : "The cleaned audience has been processed. Each accepted invitation has its provider delivery ID stored in the private ledger."}</p>{pending ? <button type="button" onClick={onSend} disabled={sending} className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60">{sending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} {sending ? "Sending invitations" : "Clean audience and send"}</button> : <span className="mt-5 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-800">Delivery recorded</span>}</div></Panel>
    </div>
  );
}

function RunsPanel({ runs, query }: { runs: RunRow[]; query: string }) {
  return (
    <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Panel title="Audit timeline" description="The 20 latest pipeline and administrator events.">
        {runs.length ? <div className="divide-y divide-slate-100">{runs.map((run, index) => <div key={`${run.created_at}-${index}`} className="flex gap-4 px-5 py-5 sm:px-6"><div className="flex flex-col items-center"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${run.run_type === "admin_action" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{run.run_type === "admin_action" ? <ShieldCheck size={16} /> : <Activity size={16} />}</span>{index < runs.length - 1 && <span className="mt-2 h-full w-px bg-slate-100" />}</div><div className="min-w-0 flex-1"><div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center"><p className="text-sm font-semibold capitalize text-slate-900">{run.run_type.replaceAll("_", " ")}</p><span className="text-[11px] text-slate-400">{formatDate(run.created_at, true)}</span></div><div className="mt-3 flex flex-wrap gap-2">{Object.entries(run.summary ?? {}).slice(0, 6).map(([key, value]) => <span key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600"><strong className="font-semibold text-slate-800">{key.replaceAll("_", " ")}:</strong> {typeof value === "object" ? JSON.stringify(value) : String(value)}</span>)}</div></div></div>)}</div> : <EmptyState title={query ? "No matching runs" : "No run history"} detail={query ? "Try a broader run type or summary term." : "Pipeline and moderation activity will appear here."} />}
      </Panel>
      <Panel title="System status" description="Core controls for this private workspace."><div className="space-y-3 p-5"><div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Gauge size={16} /></span><div><p className="text-xs font-semibold text-slate-800">Admin API</p><p className="mt-0.5 text-[11px] text-emerald-700">Connected</p></div></div><div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Database size={16} /></span><div><p className="text-xs font-semibold text-slate-800">Supabase data</p><p className="mt-0.5 text-[11px] text-emerald-700">Authorised</p></div></div><div className="flex items-center gap-3 rounded-xl border border-slate-100 p-3.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><ShieldCheck size={16} /></span><div><p className="text-xs font-semibold text-slate-800">Audit logging</p><p className="mt-0.5 text-[11px] text-emerald-700">Enabled</p></div></div></div></Panel>
    </div>
  );
}
