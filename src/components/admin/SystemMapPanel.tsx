"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Database,
  FileCheck2,
  Gauge,
  Inbox,
  Loader2,
  MailCheck,
  Play,
  Search,
  Send,
  ServerCog,
  ShieldCheck,
  UserRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { IntegrationState, IntegrationStatus } from "@/lib/integration-status";

export type RunnerTestResult = {
  state: "submitted" | "processing" | "needs_user" | "failed";
  message: string;
  receiptId?: string;
  testedAt: string;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
};

export type ApplicationRunSummary = {
  id: string;
  applicationId: string;
  jobTitle: string;
  companyName: string;
  sourceHost: string;
  status: string;
  errorCode: string | null;
  action: string | null;
  message: string | null;
  confirmationReference: string | null;
  updatedAt: string;
};

export type ApplicationWorkerQueueSummary = {
  queued: number;
  running: number;
  completed: number;
  needsUser: number;
  failed: number;
  onlineWorkers: number;
  oldestQueuedAt: string | null;
};

type MapNode = {
  id: string;
  label: string;
  description: string;
  input: string;
  output: string;
  connectsTo: string[];
  failure: string;
  action: string;
  status: IntegrationState | "built_in";
  icon: LucideIcon;
};

type Lane = { id: string; number: string; label: string; summary: string; nodes: MapNode[] };

function integration(integrations: IntegrationStatus[], id: string): IntegrationStatus | undefined {
  return integrations.find((item) => item.id === id);
}

function externalNode(
  integrations: IntegrationStatus[],
  id: string,
  label: string,
  details: Omit<MapNode, "id" | "label" | "status">
): MapNode {
  return { id, label, status: integration(integrations, id)?.state ?? "not_configured", ...details };
}

function statusCopy(status: MapNode["status"]): { label: string; className: string } {
  if (status === "connected") return { label: "Connected", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (status === "built_in") return { label: "Built in", className: "border-sky-200 bg-sky-50 text-sky-700" };
  if (status === "available") return { label: "Available", className: "border-blue-200 bg-blue-50 text-blue-700" };
  if (status === "provider_gate") return { label: "Needs setup", className: "border-amber-200 bg-amber-50 text-amber-700" };
  return { label: "Not connected", className: "border-rose-200 bg-rose-50 text-rose-700" };
}

function buildLanes(integrations: IntegrationStatus[]): Lane[] {
  const built = (node: Omit<MapNode, "status">): MapNode => ({ ...node, status: "built_in" });
  return [
    {
      id: "discover", number: "01", label: "Discover", summary: "Collect, classify and publish UK contract roles.", nodes: [
        externalNode(integrations, "reed", "Reed feed", { icon: Cloud, description: "Imports authorised Reed contract listings.", input: "Reed jobseeker API", output: "Normalised contract records", connectsTo: ["Daily source pipeline"], failure: "Missing or rejected provider key.", action: integration(integrations, "reed")?.nextStep ?? "Connect Reed." }),
        externalNode(integrations, "adzuna", "Adzuna feed", { icon: Cloud, description: "Imports UK contract search results.", input: "Adzuna search API", output: "Normalised contract records", connectsTo: ["Daily source pipeline"], failure: "Missing credentials or rate limit.", action: integration(integrations, "adzuna")?.nextStep ?? "Connect Adzuna." }),
        built({ id: "public_ats", label: "Public ATS boards", icon: BriefcaseBusiness, description: "Reads enabled Greenhouse, Lever, Ashby, Workable and SmartRecruiters boards.", input: "Admin-approved board registry", output: "Published employer roles", connectsTo: ["Daily source pipeline"], failure: "Board removed, renamed or blocks public access.", action: "Review board health in Free job sources." }),
        built({ id: "pipeline", label: "Daily source pipeline", icon: Workflow, description: "Fetches, deduplicates and evaluates IR35 evidence at 07:00 UK time.", input: "Provider and ATS listings", output: "Fresh deduplicated jobs", connectsTo: ["Supabase data", "Contract search"], failure: "A provider fails, a source changes format or the schedule does not run.", action: "Inspect Pipeline runs and rerun the source refresh." }),
        externalNode(integrations, "supabase", "Supabase data", { icon: Database, description: "Stores jobs, accounts and owner-only workspace records.", input: "Normalised jobs and user activity", output: "Secure application data", connectsTo: ["Contract search", "Application tracker", "Admin analytics"], failure: "Database connection, policy or migration problem.", action: integration(integrations, "supabase")?.nextStep ?? "Check Supabase." }),
        built({ id: "search", label: "Contract search", icon: Search, description: "Presents searchable roles with status, rate and working pattern.", input: "Live jobs from Supabase", output: "Selected role", connectsTo: ["Application workspace"], failure: "No fresh jobs or a filter removes expected results.", action: "Check inventory and source freshness." }),
      ],
    },
    {
      id: "prepare", number: "02", label: "Prepare", summary: "Build a truthful, role-specific application packet.", nodes: [
        built({ id: "profile", label: "Contractor profile", icon: UserRound, description: "Holds the facts the runner is allowed to use.", input: "User-approved identity and work details", output: "Verified application facts", connectsTo: ["CV analysis", "Application runner"], failure: "A required fact is missing or has not been approved.", action: "Ask the contractor only for the missing answer." }),
        built({ id: "cv", label: "CV analysis", icon: FileCheck2, description: "Scores role evidence and prepares truth-preserving edits.", input: "Original CV and job description", output: "Approved role-specific CV", connectsTo: ["AI tailoring", "Approved packet"], failure: "The CV cannot be parsed or evidence is too limited.", action: "Keep the original content and request better source evidence." }),
        externalNode(integrations, "ai_tailoring", "OpenRouter tailoring", { icon: Bot, description: "Improves unfamiliar wording and field mapping without inventing experience.", input: "Role, CV evidence and unknown field labels", output: "Suggested edits and field mappings", connectsTo: ["Approved packet", "Application runner"], failure: "Invalid key, provider outage or model response rejected by validation.", action: integration(integrations, "ai_tailoring")?.nextStep ?? "Check OpenRouter." }),
        built({ id: "packet", label: "Approved packet", icon: ShieldCheck, description: "Freezes the exact CV, cover letter and answers approved by the contractor.", input: "Reviewed application materials", output: "Submission-ready packet", connectsTo: ["Application runner"], failure: "Final approval is incomplete or materials changed after approval.", action: "Return the application to the review step." }),
      ],
    },
    {
      id: "apply", number: "03", label: "Apply", summary: "Complete the employer form and retain proof of the result.", nodes: [
        externalNode(integrations, "ats_submission", "Application orchestration", { icon: Workflow, description: "Validates the approved packet, queues one idempotent submission and records the final result.", input: "Approved packet and public HTTPS application URL", output: "Durable application task", connectsTo: ["Persistent portal worker", "Application tracker"], failure: "A packet is incomplete, the task cannot be queued or a duplicate request is detected.", action: integration(integrations, "ats_submission")?.nextStep ?? "Enable application orchestration." }),
        externalNode(integrations, "persistent_worker", "Persistent portal worker", { icon: ServerCog, description: "Keeps a protected Chromium session alive across multi-step forms, employer account creation and email verification.", input: "Durable application task and approved candidate facts", output: "Employer confirmation or one precise user action", connectsTo: ["Employer portal", "Application tracker"], failure: "The worker is offline, a lease expires, the employer blocks automation or a security check needs the contractor.", action: integration(integrations, "persistent_worker")?.nextStep ?? "Deploy the persistent worker." }),
        built({ id: "employer_portal", label: "Employer portal", icon: Send, description: "The original employer or ATS application form.", input: "Candidate-approved application", output: "Submission confirmation", connectsTo: ["Application tracker", "Recruiter email"], failure: "The employer changes the form, closes the role or blocks automated browsers.", action: "Move only the unresolved step to Needs you. Never claim success without confirmation." }),
        built({ id: "tracker", label: "Application tracker", icon: Gauge, description: "Records Ready, Needs you, Applied, Interview and outcome states.", input: "Runner receipt and recruiter messages", output: "Current user-visible status", connectsTo: ["Contractor workspace", "Admin analytics"], failure: "No receipt, duplicate event or webhook not processed.", action: "Inspect the application receipt and audit event." }),
      ],
    },
    {
      id: "respond", number: "04", label: "Respond", summary: "Route employer messages to the correct contractor.", nodes: [
        externalNode(integrations, "inbound_email", "Recruiter email", { icon: Inbox, description: "Receives mail sent to the private application alias.", input: "Signed Resend inbound webhook", output: "Verified message event", connectsTo: ["Message classifier"], failure: "Inbound domain, webhook signature or private alias is not active.", action: integration(integrations, "inbound_email")?.nextStep ?? "Connect inbound email." }),
        built({ id: "classifier", label: "Message classifier", icon: Bot, description: "Links confirmations, questions, interviews and rejections to the correct application.", input: "Verified inbound message", output: "Application status and notification", connectsTo: ["Application tracker", "Email forwarding"], failure: "The alias cannot be resolved or the message is ambiguous.", action: "Place the message in admin review without exposing another user." }),
        built({ id: "forwarding", label: "Email forwarding", icon: MailCheck, description: "Sends a branded update to the contractor's verified account email.", input: "Classified recruiter message", output: "Contractor notification", connectsTo: ["Contractor inbox"], failure: "Recipient suppressed, sender unverified or delivery rejected.", action: "Review delivery logs and retain the message in the workspace." }),
      ],
    },
    {
      id: "operate", number: "05", label: "Operate", summary: "Secure, observe and administer the platform.", nodes: [
        built({ id: "vercel", label: "Vercel runtime", icon: Cloud, description: "Hosts the website, protected APIs, schedules and application orchestration.", input: "Git deployment and environment configuration", output: "Production services", connectsTo: ["Every public and admin workflow"], failure: "Deployment, duration, memory or environment configuration problem.", action: "Inspect deployment and function logs." }),
        built({ id: "admin", label: "Admin control", icon: ShieldCheck, description: "Uses allowlisted identity plus a short-lived signed admin session.", input: "Verified administrator", output: "Audited operational actions", connectsTo: ["Sources", "Campaigns", "System map"], failure: "Wrong account, expired session or missing audit record.", action: "Unlock again with the authorised administrator account." }),
        built({ id: "observability", label: "Pipeline and audit logs", icon: Gauge, description: "Records source runs, campaigns, employer connections and runner tests.", input: "Operational events", output: "Traceable health evidence", connectsTo: ["Admin control"], failure: "A workflow exits before its audit event is saved.", action: "Treat the missing receipt as a failure and investigate the originating service." }),
      ],
    },
  ];
}

export function SystemMapPanel({ integrations, applicationRuns, workerQueue, query, testing, testResult, onRunTest }: { integrations: IntegrationStatus[]; applicationRuns: ApplicationRunSummary[]; workerQueue?: ApplicationWorkerQueueSummary; query: string; testing: boolean; testResult: RunnerTestResult | null; onRunTest: () => void }) {
  const lanes = useMemo(() => buildLanes(integrations), [integrations]);
  const allNodes = lanes.flatMap((lane) => lane.nodes);
  const [selectedId, setSelectedId] = useState("ats_submission");
  const selected = allNodes.find((node) => node.id === selectedId) ?? allNodes[0];
  const connected = allNodes.filter((node) => node.status === "connected" || node.status === "built_in" || node.status === "available").length;
  const attention = allNodes.length - connected;
  const term = query.trim().toLowerCase();
  const visibleRuns = applicationRuns.filter((run) =>
    !term ||
    [run.jobTitle, run.companyName, run.sourceHost, run.status, run.errorCode, run.action, run.message]
      .some((value) => value?.toLowerCase().includes(term)),
  );
  const confirmedRuns = applicationRuns.filter((run) => run.status === "succeeded").length;
  const needsUserRuns = applicationRuns.filter((run) => run.errorCode === "needs_user").length;
  const failedRuns = applicationRuns.filter((run) => run.status === "failed").length;

  return (
    <div className="mt-7 space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-sm">
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-3 sm:px-6">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-slate-500">Components healthy</p><p className="mt-2 text-3xl font-semibold">{connected}<span className="text-base text-slate-500">/{allNodes.length}</span></p></div>
          <div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-slate-500">Needs attention</p><p className="mt-2 text-3xl font-semibold text-amber-300">{attention}</p></div>
          <div className="flex items-center sm:justify-end"><button type="button" onClick={onRunTest} disabled={testing} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-bold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-70">{testing ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} fill="currentColor" />}{testing ? "Running live test" : "Run application test"}</button></div>
        </div>
        <div className="border-t border-white/10 bg-white/[0.04] px-5 py-3 text-xs leading-5 text-slate-300 sm:px-6">This controlled production test uses the real hosted runner, CV upload, multi-step form and confirmation detector. It does not contact an employer.</div>
      </section>

      {workerQueue ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-slate-950">Persistent worker queue</h2>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${workerQueue.onlineWorkers ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{workerQueue.onlineWorkers ? `${workerQueue.onlineWorkers} online` : "No worker heartbeat"}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Durable employer form tasks remain here until confirmed, paused for one user action or exhausted after controlled retries.</p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
            {[
              ["Waiting", workerQueue.queued, "text-blue-700"],
              ["Running", workerQueue.running, "text-indigo-700"],
              ["Confirmed", workerQueue.completed, "text-emerald-700"],
              ["Needs action", workerQueue.needsUser, "text-amber-700"],
              ["Failed", workerQueue.failed, "text-rose-700"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="bg-white px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
              </div>
            ))}
          </div>
          {workerQueue.oldestQueuedAt ? <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500 sm:px-6">Oldest waiting task: {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(workerQueue.oldestQueuedAt))}</p> : null}
        </section>
      ) : null}

      {testResult && (
        <section className={`rounded-2xl border p-5 ${testResult.state === "submitted" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="flex items-start gap-3">
            {testResult.state === "submitted" ? <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} /> : <CircleAlert className="mt-0.5 shrink-0 text-amber-600" size={20} />}
            <div className="min-w-0 flex-1"><p className="font-semibold text-slate-950">{testResult.state === "submitted" ? "Application runner passed" : "Application runner needs attention"}</p><p className="mt-1 text-sm leading-6 text-slate-600">{testResult.message}</p><p className="mt-2 text-xs text-slate-500">Tested {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(testResult.testedAt))}{testResult.receiptId ? ` · Receipt ${testResult.receiptId}` : ""}</p></div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{testResult.checks.map((check) => <div key={check.label} className="rounded-xl border border-black/5 bg-white/70 px-3 py-3"><p className="flex items-center gap-2 text-xs font-semibold text-slate-900">{check.passed ? <CheckCircle2 size={14} className="text-emerald-600" /> : <CircleAlert size={14} className="text-amber-600" />}{check.label}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{check.detail}</p></div>)}</div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-950">Recent real application runs</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">Employer confirmations and exact continuation requirements from the latest customer applications.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{confirmedRuns} confirmed</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{needsUserRuns} needs action</span>
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">{failedRuns} unavailable</span>
          </div>
        </div>
        {visibleRuns.length ? (
          <div className="divide-y divide-slate-100">
            {visibleRuns.slice(0, 12).map((run) => {
              const confirmed = run.status === "succeeded";
              const needsAction = run.errorCode === "needs_user";
              const label = confirmed ? "Confirmed" : needsAction ? "Needs action" : run.status === "processing" ? "Processing" : "Unavailable";
              const tone = confirmed ? "bg-emerald-50 text-emerald-700" : needsAction ? "bg-amber-50 text-amber-700" : run.status === "processing" ? "bg-blue-50 text-blue-700" : "bg-rose-50 text-rose-700";
              return (
                <article key={run.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-6">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-950">{run.jobTitle} at {run.companyName}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone}`}>{label}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{run.sourceHost || "Employer portal"} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.updatedAt))}</p>
                    {run.message ? <p className="mt-2 text-xs leading-5 text-slate-700">{run.message}</p> : null}
                  </div>
                  <dl className="grid min-w-[190px] grid-cols-2 gap-2 text-xs sm:text-right">
                    <div><dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Reason</dt><dd className="mt-1 text-slate-700">{run.errorCode || "None"}</dd></div>
                    <div><dt className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Next step</dt><dd className="mt-1 text-slate-700">{run.action || (confirmed ? "Track replies" : "Checking")}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-slate-500">No matching application runs yet.</div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="text-[15px] font-semibold text-slate-950">Live connection map</h2><p className="mt-1 text-xs leading-5 text-slate-500">Select any component to inspect its input, output, connections and recovery action.</p></div>
          <div className="space-y-0 p-4 sm:p-5">
            {lanes.map((lane, laneIndex) => {
              const visible = lane.nodes.filter((node) => !term || [node.label, node.description, node.input, node.output].some((value) => value.toLowerCase().includes(term)));
              if (!visible.length) return null;
              return <div key={lane.id} className="relative pb-6 last:pb-0">
                <div className="mb-3 flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-[10px] font-bold text-white">{lane.number}</span><div><h3 className="text-sm font-semibold text-slate-950">{lane.label}</h3><p className="mt-0.5 text-xs text-slate-500">{lane.summary}</p></div></div>
                <div className="flex flex-wrap items-stretch gap-2 sm:pl-11">
                  {visible.map((node, index) => {
                    const tone = statusCopy(node.status); const Icon = node.icon;
                    return <div key={node.id} className="contents">
                      <button type="button" onClick={() => setSelectedId(node.id)} className={`group min-h-[86px] min-w-[170px] flex-1 rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${selected.id === node.id ? "border-emerald-400 bg-emerald-50/60 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
                        <div className="flex items-center justify-between gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:bg-white"><Icon size={16} /></span><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.className}`}>{tone.label}</span></div>
                        <p className="mt-2 text-xs font-semibold text-slate-950">{node.label}</p>
                      </button>
                      {index < visible.length - 1 && <span className="hidden items-center text-slate-300 md:flex"><ArrowRight size={15} /></span>}
                    </div>;
                  })}
                </div>
                {laneIndex < lanes.length - 1 && <div className="ml-4 mt-4 h-5 border-l border-dashed border-slate-300 sm:ml-15" />}
              </div>;
            })}
          </div>
        </section>

        <aside className="self-start rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-emerald-700">Selected component</p><h2 className="mt-2 text-lg font-semibold text-slate-950">{selected.label}</h2></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusCopy(selected.status).className}`}>{statusCopy(selected.status).label}</span></div>
          <p className="mt-4 text-sm leading-6 text-slate-600">{selected.description}</p>
          <dl className="mt-5 space-y-4 text-sm">
            <div><dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Input</dt><dd className="mt-1 leading-5 text-slate-700">{selected.input}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Output</dt><dd className="mt-1 leading-5 text-slate-700">{selected.output}</dd></div>
            <div><dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Connects to</dt><dd className="mt-2 flex flex-wrap gap-1.5">{selected.connectsTo.map((item) => <span key={item} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">{item}</span>)}</dd></div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><dt className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700"><CircleAlert size={13} /> Failure signal</dt><dd className="mt-1.5 text-xs leading-5 text-amber-900">{selected.failure}</dd></div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><dt className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700"><Workflow size={13} /> Recovery action</dt><dd className="mt-1.5 text-xs leading-5 text-emerald-900">{selected.action}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
