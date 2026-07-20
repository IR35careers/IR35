"use client";

/**
 * /admin — the founder control panel (v1).
 * Sidebar sections: Overview · Users · Waitlist · Jobs · Pipeline runs.
 * Access requires sign-in + email present in ADMIN_EMAILS. Non-admins see a
 * clean "no access" screen. All reads/writes go through /api/admin with the
 * caller's bearer token; expirations are audit-logged.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  LayoutDashboard,
  Users,
  Clock,
  Briefcase,
  Activity,
  ShieldAlert,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

type Section = "stats" | "users" | "waitlist" | "jobs" | "runs";

const NAV: Array<{ id: Section; label: string; icon: typeof Users }> = [
  { id: "stats", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "waitlist", label: "Waitlist", icon: Clock },
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "runs", label: "Pipeline runs", icon: Activity },
];

async function adminFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  return fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AdminPage() {
  const { user, loading } = useAuth();
  const [section, setSection] = useState<Section>("stats");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: Section) => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin?section=${s}`);
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && user) load(section);
    if (!loading && !user) setForbidden(true);
  }, [user, loading, section, load]);

  const expireJob = async (jobId: string) => {
    const res = await adminFetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "expire_job", jobId }),
    });
    if (res.ok) load("jobs");
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  if (forbidden) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center text-slate-900">
        <ShieldAlert size={36} className="text-amber-600" />
        <h1 className="text-xl font-medium">Admin access required</h1>
        <p className="max-w-sm text-sm text-slate-500">
          Sign in with an account listed in ADMIN_EMAILS to open the control panel.
        </p>
        <Link href="/account?next=/admin" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200/70 bg-white p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-green-700">Admin panel</p>
          <p className="mt-0.5 text-sm font-bold">IR35Careers</p>
        </div>
        <nav className="mt-6 space-y-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                section === item.id ? "bg-slate-900 text-white font-semibold" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <item.icon size={15} /> {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto border-t border-slate-200/70 pt-4">
          <p className="truncate text-xs font-medium text-slate-800">Admin</p>
          <p className="truncate text-[11px] text-slate-400">{user?.email}</p>
          <button onClick={() => { window.location.href = "/"; }} className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900">
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1 p-6">
        <h1 className="text-xl font-medium capitalize">{NAV.find((n) => n.id === section)?.label}</h1>

        {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        {busy ? (
          <div className="mt-16 flex justify-center text-slate-500">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : section === "stats" && data ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
              {[
                ["Total users", data.totalUsers],
                ["Profiles", data.profiles],
                ["CVs uploaded", data.cvsUploaded],
                ["Waitlist", data.waitlist],
                ["Live jobs", data.liveJobs],
                ["Expired jobs", data.expiredJobs],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-2xl font-semibold tabular-nums">{value ?? "—"}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>
            {data.lastPipelineRun && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-sm font-medium text-slate-800">
                  Last pipeline run · {new Date(data.lastPipelineRun.created_at).toLocaleString("en-GB")}
                </p>
                <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-600">
                  {JSON.stringify(data.lastPipelineRun.summary, null, 2)}
                </pre>
              </div>
            )}
          </>
        ) : section === "users" && data ? (
          <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Skills</th>
                  <th className="px-4 py-3">CV</th>
                  <th className="px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(data.users ?? []).map((u: any) => (
                  <tr key={u.id} className="hover:bg-white">
                    <td className="px-4 py-3 text-slate-800">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600">{u.profile?.full_name || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{u.provider}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{u.profile?.skills?.length ?? 0}</td>
                    <td className="px-4 py-3">{u.profile?.cv_filename ? <span className="text-green-700">✓</span> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(u.created_at).toLocaleDateString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : section === "waitlist" && data ? (
          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Signed up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(data.waitlist ?? []).map((w: any) => (
                  <tr key={w.email} className="hover:bg-white">
                    <td className="px-4 py-3 text-slate-800">{w.email}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(w.created_at).toLocaleString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : section === "jobs" && data ? (
          <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">IR35</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(data.jobs ?? []).map((j: any) => (
                  <tr key={j.id} className="hover:bg-white">
                    <td className="max-w-[280px] truncate px-4 py-3 text-slate-800">
                      <Link href={`/jobs/${j.id}`} className="hover:underline">{j.title}</Link>
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-3 text-slate-600">{j.company_name}</td>
                    <td className="px-4 py-3 text-slate-500">{j.source_domain}</td>
                    <td className="px-4 py-3 text-slate-600">{j.ir35_status}</td>
                    <td className="px-4 py-3">
                      {j.expired_at ? <span className="text-slate-400">expired</span> : <span className="text-green-700">live</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!j.expired_at && (
                        <button
                          onClick={() => expireJob(j.id)}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600 transition-colors hover:bg-red-100"
                        >
                          Expire
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : section === "runs" && data ? (
          <ul className="mt-5 space-y-3">
            {(data.runs ?? []).map((r: any, i: number) => (
              <li key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-medium text-slate-800">
                  {r.run_type} · {new Date(r.created_at).toLocaleString("en-GB")}
                </p>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-600">
                  {JSON.stringify(r.summary, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </div>
  );
}
