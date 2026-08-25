"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  ChevronRight,
  Download,
  Plus,
  RotateCcw,
  Search,
  Upload,
  X,
} from "lucide-react";
import {
  WorkspacePage,
  StatusPill,
} from "@/components/workspace/WorkspacePage";
import { fetchWithFreshSession } from "@/lib/authenticated-fetch";
import { hasActiveSubmission } from "@/lib/application-submission-state";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { newWorkspaceId } from "@/lib/workspace/engine";
import {
  resetWorkspace,
  updateWorkspace,
  useWorkspaceState,
} from "@/lib/workspace/store";
import type {
  ApplicationRecord,
  ApplicationStatus,
} from "@/lib/workspace/types";

const PIPELINE: Array<{ id: ApplicationStatus; label: string }> = [
  { id: "needs_review", label: "Needs you" },
  { id: "ready", label: "Ready" },
  { id: "applied", label: "Applied" },
  { id: "replied", label: "Replied" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
];

type ApplicationView =
  | "all"
  | "submitted"
  | "in_flight"
  | "needs_review"
  | "failed"
  | "skipped";

const APPLICATION_VIEWS: Array<{ id: ApplicationView; label: string }> = [
  { id: "all", label: "All" },
  { id: "submitted", label: "Submitted" },
  { id: "in_flight", label: "In flight" },
  { id: "needs_review", label: "Needs you" },
  { id: "failed", label: "Not submitted" },
  { id: "skipped", label: "Skipped" },
];

function matchesApplicationView(
  status: ApplicationStatus,
  view: ApplicationView,
): boolean {
  if (view === "all") return true;
  if (view === "submitted")
    return ["applied", "viewed", "replied", "interview", "offer", "rejected"].includes(status);
  if (view === "in_flight")
    return ["ready", "applied", "viewed", "replied", "interview"].includes(status);
  return status === view;
}

function resumeLabel(value: string) {
  return value.replace(/\bCV\b/gi, "Resume");
}

function csvValue(value: unknown): string {
  const raw = String(value ?? "");
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }
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

function manualRecord(input: {
  company: string;
  role: string;
  location: string;
  url: string;
  status: ApplicationStatus;
  date: string;
}): ApplicationRecord {
  const id = newWorkspaceId();
  const createdAt = input.date
    ? new Date(`${input.date}T12:00:00`).toISOString()
    : new Date().toISOString();
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
    resumeVersionLabel: "Application Resume",
    coverLetter: "",
    questions: [],
    truthApproved: false,
    materialsApproved: false,
    submissionApproved: false,
    mode: "dry_run",
    receipt: null,
    createdAt,
    updatedAt: createdAt,
    events: [
      {
        id: newWorkspaceId(),
        applicationId: id,
        type: "created",
        label: "Application added to tracker",
        createdAt,
      },
    ],
  };
}

export function ApplicationTracker() {
  const workspace = useWorkspaceState();
  const [view, setView] = useState<ApplicationView>("all");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState({
    company: "",
    role: "",
    location: "",
    url: "",
    status: "applied" as ApplicationStatus,
    date: new Date().toISOString().slice(0, 10),
  });
  const importRef = useRef<HTMLInputElement>(null);
  const applications = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.applications.filter((application) => {
      const statusMatches = matchesApplicationView(application.status, view);
      const searchMatches =
        !needle ||
        `${application.job.company_name} ${application.job.title} ${application.job.location}`
          .toLowerCase()
          .includes(needle);
      return statusMatches && searchMatches;
    });
  }, [query, view, workspace.applications]);
  const messageCounts = useMemo(
    () =>
      new Map(
        workspace.applications.map((application) => [
          application.id,
          workspace.messages.filter(
            (message) => message.applicationId === application.id,
          ).length,
        ]),
      ),
    [workspace.applications, workspace.messages],
  );
  const refreshIds = useMemo(
    () =>
      workspace.applications
        .filter((item) =>
          hasActiveSubmission(item.status, item.events, item.attention),
        )
        .slice(0, 10)
        .map((item) => item.id),
    [workspace.applications],
  );

  useEffect(() => {
    if (!isSupabaseConfigured() || refreshIds.length === 0) return;
    let active = true;
    const refresh = async () => {
      try {
        if (!active) return;
        for (const applicationId of refreshIds) {
          const response = await fetchWithFreshSession(
            `/api/applications/submission-status?applicationId=${encodeURIComponent(applicationId)}`,
            { cache: "no-store" },
          );
          const payload = (await response.json()) as {
            state?: "submitted" | "processing" | "needs_user" | "failed";
            receipt?: ApplicationRecord["receipt"];
            questions?: ApplicationRecord["questions"];
            attention?: ApplicationRecord["attention"];
            action?: string;
            error?: string;
          };
          if (payload.state === "failed") {
            if (payload.action === "source_access_denied" && active)
              updateWorkspace((current) => ({
                ...current,
                applications: current.applications.map((application) =>
                  application.id === applicationId
                    ? {
                        ...application,
                        status: "failed",
                        attention: payload.attention ?? application.attention,
                        updatedAt: new Date().toISOString(),
                      }
                    : application,
                ),
              }));
            if (active)
              setNotice(
                payload.error ||
                  "The previous application attempt stopped. Open the application to retry.",
              );
            continue;
          }
          if (!response.ok && response.status !== 202) continue;
          if (
            !active ||
            (payload.state !== "submitted" && payload.state !== "needs_user")
          )
            continue;
          updateWorkspace((current) => ({
            ...current,
            applications: current.applications.map((application) =>
              application.id !== applicationId
                ? application
                : {
                    ...application,
                    status:
                      payload.state === "submitted"
                        ? "applied"
                        : "needs_review",
                    receipt: payload.receipt ?? application.receipt,
                    mode:
                      payload.state === "submitted"
                        ? "external_handoff"
                        : application.mode,
                    questions: payload.questions ?? application.questions,
                    attention:
                      payload.state === "needs_user"
                        ? (payload.attention ?? application.attention)
                        : null,
                    submissionApproved:
                      payload.state === "needs_user"
                        ? false
                        : application.submissionApproved,
                    updatedAt: new Date().toISOString(),
                  },
            ),
          }));
        }
      } catch (error) {
        if (active)
          setNotice(
            error instanceof Error
              ? error.message
              : "Application status could not be refreshed.",
          );
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refreshIds]);

  const exportCsv = () => {
    const header = [
      "Company",
      "Role",
      "Location",
      "Status",
      "Applied date",
      "Job URL",
      "Email count",
    ];
    const rows = workspace.applications.map((application) => [
      application.job.company_name,
      application.job.title,
      application.job.location,
      application.status,
      application.createdAt.slice(0, 10),
      application.job.apply_url,
      messageCounts.get(application.id) ?? 0,
    ]);
    const blob = new Blob(
      [
        [header, ...rows]
          .map((row) => row.map(csvValue).join(","))
          .join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
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
    const lines = (await file.text())
      .split(/\r?\n/)
      .filter((line) => line.trim());
    if (lines.length < 2) {
      setNotice("The CSV did not contain application rows.");
      return;
    }
    const headers = parseCsvLine(lines[0]).map((header) =>
      header.toLowerCase(),
    );
    const find = (names: string[]) =>
      headers.findIndex((header) =>
        names.some((name) => header.includes(name)),
      );
    const indexes = {
      company: find(["company", "employer"]),
      role: find(["role", "title", "position"]),
      location: find(["location"]),
      status: find(["status", "stage"]),
      date: find(["date", "applied"]),
      url: find(["url", "link"]),
    };
    const imported = lines
      .slice(1)
      .map(parseCsvLine)
      .filter(
        (row) => row[indexes.company]?.trim() && row[indexes.role]?.trim(),
      )
      .map((row) =>
        manualRecord({
          company: row[indexes.company],
          role: row[indexes.role],
          location: indexes.location >= 0 ? row[indexes.location] : "",
          status: importedStatus(
            indexes.status >= 0 ? row[indexes.status] : "applied",
          ),
          date: indexes.date >= 0 ? row[indexes.date]?.slice(0, 10) : "",
          url: indexes.url >= 0 ? row[indexes.url] : "",
        }),
      );
    if (!imported.length) {
      setNotice("No valid company and role rows were found.");
      return;
    }
    updateWorkspace((current) => ({
      ...current,
      applications: [...imported, ...current.applications],
    }));
    setNotice(
      `${imported.length} application${imported.length === 1 ? "" : "s"} imported.`,
    );
  };

  const addApplication = () => {
    if (!manual.company.trim() || !manual.role.trim()) return;
    const application = manualRecord(manual);
    updateWorkspace((current) => ({
      ...current,
      applications: [application, ...current.applications],
    }));
    setManual({
      company: "",
      role: "",
      location: "",
      url: "",
      status: "applied",
      date: new Date().toISOString().slice(0, 10),
    });
    setAddOpen(false);
    setNotice("Application added to your pipeline.");
  };

  return (
    <WorkspacePage
      eyebrow="Applications"
      title="Your contract pipeline"
      description="Track prepared applications, employer responses, interviews and outcomes in one place."
      actions={
        <Link
          href="/jobs"
          className="ir35-focus hidden min-h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 sm:inline-flex"
        >
          Browse contracts <ArrowRight size={15} />
        </Link>
      }
    >
      <section className="ir35-card p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search applications</span>
            <Search
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              size={17}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search companies or roles"
              className="ir35-focus min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 pl-11 pr-4 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              ref={importRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void importCsv(event)}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800"
            >
              <Plus size={16} /> Add application
            </button>
            <details className="relative">
              <summary className="ir35-focus inline-flex min-h-11 cursor-pointer list-none items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Import / export</summary>
              <div className="absolute right-0 z-20 mt-2 grid w-48 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                <button type="button" onClick={() => importRef.current?.click()} className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Upload size={15} /> Import CSV</button>
                <button type="button" onClick={exportCsv} disabled={!workspace.applications.length} className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"><Download size={15} /> Export CSV</button>
              </div>
            </details>
          </div>
        </div>
        {notice && (
          <p className="mt-3 text-sm font-medium text-brand-800" role="status">
            {notice}
          </p>
        )}
      </section>

      <section
        className="ir35-card mt-5 flex snap-x snap-mandatory overflow-x-auto lg:grid lg:grid-cols-6 lg:overflow-hidden"
        aria-label="Application pipeline summary"
      >
        {PIPELINE.map((stage, index) => {
          const count = workspace.applications.filter(
            (application) => application.status === stage.id,
          ).length;
          return (
            <div
              key={stage.id}
              className={`min-w-[118px] snap-start px-4 py-3.5 lg:min-h-[92px] lg:min-w-0 lg:py-4 ${index < PIPELINE.length - 1 ? "border-r border-slate-200" : ""}`}
            >
              <p className="text-xl font-bold tabular-nums text-slate-950 lg:text-2xl">
                {count}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                {stage.label}
              </p>
            </div>
          );
        })}
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
          {APPLICATION_VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`ir35-focus min-h-10 shrink-0 rounded-lg px-4 text-sm font-semibold ${view === item.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {!isSupabaseConfigured() && (
          <button
            type="button"
            onClick={resetWorkspace}
            className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-600"
          >
            <RotateCcw size={15} /> Reset preview
          </button>
        )}
      </div>

      {applications.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <BriefcaseBusiness className="mx-auto text-slate-400" />
          <h2 className="mt-4 font-semibold">No applications in this view</h2>
          <p className="mt-1 text-sm text-slate-600">
            Prepare a contract or add an existing application.
          </p>
        </div>
      ) : (
        <section className="ir35-card mt-6 overflow-hidden">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-5 py-4">Contract</th>
                  <th className="px-5 py-4">Resume</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Updated</th>
                  <th className="px-5 py-4"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {applications.map((application) => {
                  const attention = application.attention;
                  const actionLabel = application.status === "needs_review"
                    ? "Review and apply"
                    : application.status === "failed"
                      ? "Review and retry"
                      : application.status === "ready"
                        ? "Review and apply"
                        : "View application";
                  return (
                    <tr key={application.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold text-brand-800">{application.job.company_name.slice(0, 1).toUpperCase()}</span>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-950">{application.job.title}</p>
                            <p className="mt-1 text-xs text-slate-500">{application.job.company_name} · {application.job.location}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <p className="max-w-48 truncate text-sm font-medium text-slate-800">{resumeLabel(application.resumeVersionLabel)}</p>
                        <p className="mt-1 text-xs text-slate-500">{application.matchScore}% match</p>
                      </td>
                      <td className="px-5 py-4">
                        <StatusPill status={application.status} />
                        {attention && <p className="mt-2 max-w-56 line-clamp-2 text-xs leading-5 text-amber-800">{attention.title}</p>}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">
                        {new Date(application.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        <p className="mt-1 text-xs text-slate-400">{messageCounts.get(application.id) ?? 0} linked message{(messageCounts.get(application.id) ?? 0) === 1 ? "" : "s"}</p>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link href={`/applications/new/${application.job.id}?applicationId=${encodeURIComponent(application.id)}${attention ? "#needs-attention" : ""}`} className={`ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold ${application.status === "ready" || application.status === "needs_review" ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}>
                          {actionLabel} <ChevronRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="divide-y divide-slate-100 md:hidden">
            {applications.map((application) => {
              const attention = application.attention;
              const actionLabel = application.status === "needs_review"
                ? "Review and apply"
                : application.status === "failed"
                  ? "Review and retry"
                  : application.status === "ready"
                    ? "Review and apply"
                    : "View application";
              return (
                <article key={application.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <StatusPill status={application.status} />
                      <h2 className="mt-3 text-lg font-semibold text-slate-950">{application.job.title}</h2>
                      <p className="mt-1 text-sm text-slate-600">{application.job.company_name} · {application.job.location}</p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-slate-500">{application.matchScore}% match</span>
                  </div>
                  {attention && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><strong className="block">{attention.title}</strong>{attention.message}</div>}
                  <div className="mt-4 flex items-center justify-between text-xs text-slate-500"><span>{resumeLabel(application.resumeVersionLabel)}</span><span>{messageCounts.get(application.id) ?? 0} messages</span></div>
                  <Link href={`/applications/new/${application.job.id}?applicationId=${encodeURIComponent(application.id)}${attention ? "#needs-attention" : ""}`} className={`ir35-focus mt-4 inline-flex min-h-11 w-full items-center justify-between rounded-xl px-4 text-sm font-bold ${application.status === "ready" || application.status === "needs_review" ? "bg-emerald-700 text-white" : "border border-slate-300 text-slate-700"}`}>
                    {actionLabel} <ChevronRight size={15} />
                  </Link>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {addOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center sm:p-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-application-title"
            className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-700">
                  Pipeline
                </p>
                <h2
                  id="add-application-title"
                  className="mt-1 text-xl font-semibold"
                >
                  Add an application
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                aria-label="Close add application"
                className="ir35-focus flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Company
                <input
                  value={manual.company}
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      company: event.target.value,
                    }))
                  }
                  className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
                />
              </label>
              <label className="text-sm font-semibold">
                Role
                <input
                  value={manual.role}
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      role: event.target.value,
                    }))
                  }
                  className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
                />
              </label>
              <label className="text-sm font-semibold">
                Location
                <input
                  value={manual.location}
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      location: event.target.value,
                    }))
                  }
                  className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
                />
              </label>
              <label className="text-sm font-semibold">
                Status
                <select
                  value={manual.status}
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      status: event.target.value as ApplicationStatus,
                    }))
                  }
                  className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
                >
                  <option value="applied">Applied</option>
                  <option value="interview">Interviewing</option>
                  <option value="offer">Offer</option>
                  <option value="rejected">Rejected</option>
                  <option value="ready">Ready</option>
                </select>
              </label>
              <label className="text-sm font-semibold">
                Application date
                <input
                  type="date"
                  value={manual.date}
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                  className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
                />
              </label>
              <label className="text-sm font-semibold">
                Job URL
                <input
                  type="url"
                  value={manual.url}
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      url: event.target.value,
                    }))
                  }
                  placeholder="https://"
                  className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="ir35-focus min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addApplication}
                disabled={!manual.company.trim() || !manual.role.trim()}
                className="ir35-focus min-h-11 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white disabled:opacity-40"
              >
                Add to pipeline
              </button>
            </div>
          </section>
        </div>
      )}
    </WorkspacePage>
  );
}
