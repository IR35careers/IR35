"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowRight, BriefcaseBusiness, CalendarClock, ChevronRight, Download, Inbox, Plus, RotateCcw, Search, Upload, X } from "lucide-react";
import { WorkspacePage, StatusPill } from "@/components/workspace/WorkspacePage";
import { getSupabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { newWorkspaceId } from "@/lib/workspace/engine";
import { resetWorkspace, updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { ApplicationRecord, ApplicationStatus } from "@/lib/workspace/types";

const PIPELINE: Array<{ id: ApplicationStatus; label: string }> = [
  { id: "needs_review", label: "Needs you" },
  { id: "ready", label: "Ready" },
  { id: "applied", label: "Applied" },
  { id: "replied", label: "Replied" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
];

const CLOSED_STATUSES = new Set<ApplicationStatus>(["offer", "rejected", "withdrawn", "failed", "skipped"]);
const BOARD_COLUMNS = ["Applied", "Ghosted", "Interviewing", "Rejected", "Offer"] as const;
type BoardColumn = typeof BOARD_COLUMNS[number];

function csvValue(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { current += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { values.push(current.trim()); current = ""; continue; }
    current += character;
  }
  values.push(current.trim());
  return values;
}

function importedStatus(value: string): ApplicationStatus {
  const status = value.trim().toLowerCase();
  if (status.includes("offer")) return "offer";
  if (status.includes("interview")) return "interview";
  if (status.includes("reject")) return "rejected";
  if (status.includes("ready")) return "ready";
  if (status.includes("need")) return "needs_review";
  return "applied";
}

function boardColumn(application: ApplicationRecord, messages: number): BoardColumn | null {
  if (application.status === "offer") return "Offer";
  if (application.status === "rejected") return "Rejected";
  if (application.status === "interview") return "Interviewing";
  const age = Date.now() - new Date(application.updatedAt).getTime();
  if ((application.status === "applied" || application.status === "viewed") && messages === 0 && age > 14 * 86_400_000) return "Ghosted";
  if (["applied", "viewed", "replied"].includes(application.status)) return "Applied";
  return null;
}

function manualRecord(input: { company: string; role: string; location: string; url: string; status: ApplicationStatus; date: string }): ApplicationRecord {
  const id = newWorkspaceId();
  const createdAt = input.date ? new Date(`${input.date}T12:00:00`).toISOString() : new Date().toISOString();
  return {
    id,
    job: {
      id,
      title: input.role.trim(),
      company_name: input.company.trim(),
      location: input.location.trim() || "United Kingdom",
      remote_type: "unknown",
      ir35_status: "unknown",
      ir35_confidence: "low",
      rate_min: null,
      rate_max: null,
      rate_currency: "GBP",
      rate_type: "unknown",
      skills: [],
      posted_at: null,
      first_seen_at: createdAt,
      description: "Manually added application.",
      apply_url: input.url.trim() || "https://www.ir35careers.com/applications",
      source_domain: "manual.ir35careers.local",
    },
    status: input.status,
    matchScore: 0,
    matchedKeywords: [],
    missingKeywords: [],
    sourceCvText: "",
    tailoredCvText: "",
    resumeVersionLabel: "Application CV",
    coverLetter: "",
    questions: [],
    truthApproved: false,
    materialsApproved: false,
    submissionApproved: false,
    mode: "dry_run",
    receipt: null,
    createdAt,
    updatedAt: createdAt,
    events: [{ id: newWorkspaceId(), applicationId: id, type: "created", label: "Application added to tracker", createdAt }],
  };
}

export function ApplicationTracker() {
  const workspace = useWorkspaceState();
  const [filter, setFilter] = useState<"active" | "all" | "closed">("active");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState({ company: "", role: "", location: "", url: "", status: "applied" as ApplicationStatus, date: new Date().toISOString().slice(0, 10) });
  const importRef = useRef<HTMLInputElement>(null);
  const applications = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.applications.filter((application) => {
      const statusMatches = filter === "all" || (filter === "closed" ? CLOSED_STATUSES.has(application.status) : !CLOSED_STATUSES.has(application.status));
      const searchMatches = !needle || `${application.job.company_name} ${application.job.title} ${application.job.location}`.toLowerCase().includes(needle);
      return statusMatches && searchMatches;
    });
  }, [filter, query, workspace.applications]);
  const messageCounts = useMemo(() => new Map(workspace.applications.map((application) => [application.id, workspace.messages.filter((message) => message.applicationId === application.id).length])), [workspace.applications, workspace.messages]);
  const board = useMemo(() => Object.fromEntries(BOARD_COLUMNS.map((column) => [column, workspace.applications.filter((application) => boardColumn(application, messageCounts.get(application.id) ?? 0) === column)])) as Record<BoardColumn, ApplicationRecord[]>, [messageCounts, workspace.applications]);
  const outcomeTotal = Math.max(1, board.Applied.length + board.Rejected.length);
  const refreshIds = useMemo(() => workspace.applications.filter((item) => item.status === "ready" || item.status === "needs_review").slice(0, 10).map((item) => item.id), [workspace.applications]);

  useEffect(() => {
    if (!isSupabaseConfigured() || refreshIds.length === 0) return;
    let active = true;
    const refresh = async () => {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token || !active) return;
      for (const applicationId of refreshIds) {
        const response = await fetch(`/api/applications/submission-status?applicationId=${encodeURIComponent(applicationId)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok && response.status !== 202) continue;
        const payload = (await response.json()) as { state?: "submitted" | "processing" | "needs_user"; receipt?: ApplicationRecord["receipt"]; questions?: ApplicationRecord["questions"] };
        if (!active || (payload.state !== "submitted" && payload.state !== "needs_user")) continue;
        updateWorkspace((current) => ({ ...current, applications: current.applications.map((application) => application.id !== applicationId ? application : { ...application, status: payload.state === "submitted" ? "applied" : "needs_review", receipt: payload.receipt ?? application.receipt, mode: payload.state === "submitted" ? "external_handoff" : application.mode, questions: payload.questions ?? application.questions, submissionApproved: payload.state === "needs_user" ? false : application.submissionApproved, updatedAt: new Date().toISOString() }) }));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refreshIds]);

  const exportCsv = () => {
    const header = ["Company", "Role", "Location", "Status", "Applied date", "Job URL", "Email count"];
    const rows = workspace.applications.map((application) => [application.job.company_name, application.job.title, application.job.location, application.status, application.createdAt.slice(0, 10), application.job.apply_url, messageCounts.get(application.id) ?? 0]);
    const blob = new Blob([[header, ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ir35careers-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const lines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) { setNotice("The CSV did not contain application rows."); return; }
    const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
    const find = (names: string[]) => headers.findIndex((header) => names.some((name) => header.includes(name)));
    const indexes = { company: find(["company", "employer"]), role: find(["role", "title", "position"]), location: find(["location"]), status: find(["status", "stage"]), date: find(["date", "applied"]), url: find(["url", "link"]) };
    const imported = lines.slice(1).map(parseCsvLine).filter((row) => row[indexes.company]?.trim() && row[indexes.role]?.trim()).map((row) => manualRecord({ company: row[indexes.company], role: row[indexes.role], location: indexes.location >= 0 ? row[indexes.location] : "", status: importedStatus(indexes.status >= 0 ? row[indexes.status] : "applied"), date: indexes.date >= 0 ? row[indexes.date]?.slice(0, 10) : "", url: indexes.url >= 0 ? row[indexes.url] : "" }));
    if (!imported.length) { setNotice("No valid company and role rows were found."); return; }
    updateWorkspace((current) => ({ ...current, applications: [...imported, ...current.applications] }));
    setNotice(`${imported.length} application${imported.length === 1 ? "" : "s"} imported.`);
  };

  const addApplication = () => {
    if (!manual.company.trim() || !manual.role.trim()) return;
    const application = manualRecord(manual);
    updateWorkspace((current) => ({ ...current, applications: [application, ...current.applications] }));
    setManual({ company: "", role: "", location: "", url: "", status: "applied", date: new Date().toISOString().slice(0, 10) });
    setAddOpen(false);
    setNotice("Application added to your pipeline.");
  };

  return (
    <WorkspacePage eyebrow="Applications" title="Your contract pipeline" description="Track prepared applications, employer responses, interviews and outcomes in one place." actions={<Link href="/jobs" className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">Browse contracts <ArrowRight size={15} /></Link>}>
      <nav className="mb-5 flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1" aria-label="Application communication views"><Link href="/inbox" className="ir35-focus inline-flex min-h-10 items-center rounded-xl px-5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Inbox</Link><span aria-current="page" className="inline-flex min-h-10 items-center rounded-xl bg-slate-950 px-5 text-sm font-bold text-white">Pipeline</span></nav>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><label className="relative block min-w-0 flex-1"><span className="sr-only">Search applications</span><Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies or roles" className="ir35-focus min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 pl-11 pr-4 text-sm" /></label><div className="flex flex-wrap gap-2"><input ref={importRef} type="file" accept=".csv,text/csv" onChange={(event) => void importCsv(event)} className="sr-only" /><button type="button" onClick={() => importRef.current?.click()} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"><Upload size={15} /> Import CSV</button><button type="button" onClick={exportCsv} disabled={!workspace.applications.length} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-40"><Download size={15} /> Export CSV</button><button type="button" onClick={() => setAddOpen(true)} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white"><Plus size={16} /> Add application</button></div></div>
        {notice && <p className="mt-3 text-sm font-medium text-brand-800" role="status">{notice}</p>}
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <article className="overflow-hidden rounded-3xl bg-gradient-to-br from-blue-700 via-blue-600 to-violet-600 p-6 text-white shadow-card"><p className="text-xs font-bold uppercase tracking-[0.15em] text-blue-100">Application outcomes</p><div className="mt-5 grid grid-cols-2 gap-4"><div><p className="text-3xl font-bold">{board.Applied.length}</p><p className="mt-1 text-sm text-blue-100">Applied</p></div><div><p className="text-3xl font-bold">{board.Rejected.length}</p><p className="mt-1 text-sm text-blue-100">Rejected</p></div></div><div className="mt-6 flex h-3 overflow-hidden rounded-full bg-white/15"><span className="bg-cyan-300" style={{ width: `${Math.round(board.Applied.length / outcomeTotal * 100)}%` }} /><span className="bg-rose-300" style={{ width: `${Math.round(board.Rejected.length / outcomeTotal * 100)}%` }} /></div><p className="mt-4 text-xs leading-5 text-blue-100">Based on the applications and recruiter messages currently in your workspace.</p></article>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{BOARD_COLUMNS.map((column) => <article key={column} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-2xl font-bold text-slate-950">{board[column].length}</p><p className="mt-1 text-xs font-semibold text-slate-600">{column}</p>{board[column].slice(0, 2).map((application) => <div key={application.id} className="mt-3 border-t border-slate-100 pt-3"><p className="truncate text-xs font-bold text-slate-800">{application.job.company_name}</p><p className="mt-1 truncate text-[11px] text-slate-500">{application.job.title}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-slate-400"><Inbox size={11} /> {messageCounts.get(application.id) ?? 0}</p></div>)}</article>)}</div>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Application pipeline summary">{PIPELINE.map((stage) => { const count = workspace.applications.filter((application) => application.status === stage.id).length; return <div key={stage.id} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-2xl font-bold tabular-nums text-slate-950">{count}</p><p className="mt-1 text-xs font-semibold text-slate-600">{stage.label}</p></div>; })}</section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">{(["active", "all", "closed"] as const).map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`ir35-focus min-h-10 rounded-lg px-4 text-sm font-semibold capitalize ${filter === item ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{item}</button>)}</div>{!isSupabaseConfigured() && <button type="button" onClick={resetWorkspace} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-600"><RotateCcw size={15} /> Reset preview</button>}</div>

      {applications.length === 0 ? <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center"><BriefcaseBusiness className="mx-auto text-slate-400" /><h2 className="mt-4 font-semibold">No applications in this view</h2><p className="mt-1 text-sm text-slate-600">Prepare a contract or add an existing application.</p></div> : <div className="mt-6 grid gap-4">{applications.map((application) => <article key={application.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px_220px] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusPill status={application.status} /><span className="text-xs font-semibold text-slate-500">{application.matchScore}% CV match</span></div><h2 className="mt-2 truncate text-lg font-semibold text-slate-950">{application.job.title}</h2><p className="truncate text-sm text-slate-600">{application.job.company_name} · {application.job.location}</p><p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><CalendarClock size={13} /> Updated {new Date(application.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p></div><div className="rounded-2xl bg-slate-50 px-4 py-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Linked messages</p><p className="mt-2 text-2xl font-bold text-slate-950">{messageCounts.get(application.id) ?? 0}</p><p className="mt-1 text-xs text-slate-500">Recruiter updates for this role</p></div><div className="flex flex-col gap-2"><Link href={`/applications/new/${application.job.id}`} className={`ir35-focus inline-flex min-h-11 items-center justify-between rounded-xl px-4 text-sm font-bold ${application.status === "ready" || application.status === "needs_review" ? "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800" : "border border-slate-300 text-slate-700 hover:border-brand-300"}`}>{application.status === "ready" || application.status === "needs_review" ? "Review and apply" : "View application"} <ChevronRight size={15} /></Link><Link href={`/jobs/${application.job.id}`} className="ir35-focus inline-flex min-h-11 items-center justify-between rounded-xl px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50">Open role <ChevronRight size={15} /></Link></div></div><ol className="mt-5 grid gap-2 border-t border-slate-100 pt-5 md:grid-cols-3">{application.events.slice(-3).map((event) => <li key={event.id} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-800">{event.label}</p><p className="mt-1 text-[11px] text-slate-500">{new Date(event.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p></li>)}</ol></article>)}</div>}

      {addOpen && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center sm:p-6"><section role="dialog" aria-modal="true" aria-labelledby="add-application-title" className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-700">Pipeline</p><h2 id="add-application-title" className="mt-1 text-xl font-semibold">Add an application</h2></div><button type="button" onClick={() => setAddOpen(false)} aria-label="Close add application" className="ir35-focus flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100"><X size={18} /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Company<input value={manual.company} onChange={(event) => setManual((current) => ({ ...current, company: event.target.value }))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label><label className="text-sm font-semibold">Role<input value={manual.role} onChange={(event) => setManual((current) => ({ ...current, role: event.target.value }))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label><label className="text-sm font-semibold">Location<input value={manual.location} onChange={(event) => setManual((current) => ({ ...current, location: event.target.value }))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label><label className="text-sm font-semibold">Status<select value={manual.status} onChange={(event) => setManual((current) => ({ ...current, status: event.target.value as ApplicationStatus }))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"><option value="applied">Applied</option><option value="interview">Interviewing</option><option value="offer">Offer</option><option value="rejected">Rejected</option><option value="ready">Ready</option></select></label><label className="text-sm font-semibold">Application date<input type="date" value={manual.date} onChange={(event) => setManual((current) => ({ ...current, date: event.target.value }))} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label><label className="text-sm font-semibold">Job URL<input type="url" value={manual.url} onChange={(event) => setManual((current) => ({ ...current, url: event.target.value }))} placeholder="https://" className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setAddOpen(false)} className="ir35-focus min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">Cancel</button><button type="button" onClick={addApplication} disabled={!manual.company.trim() || !manual.role.trim()} className="ir35-focus min-h-11 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white disabled:opacity-40">Add to pipeline</button></div></section></div>}
    </WorkspacePage>
  );
}
