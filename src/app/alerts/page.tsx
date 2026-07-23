"use client";

/**
 * /alerts — saved searches ("job alerts"). Users create, view, run, and delete
 * alerts. Email delivery is added when an email service is connected; until
 * then this is a saved-search manager (each alert opens as a live search).
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Loader2, Bell, Trash2, ArrowRight, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { PROFILE_SKILL_OPTIONS } from "@/lib/profile";
import { AppNav } from "@/components/AppNav";

interface Alert {
  id: string;
  name: string;
  q: string | null;
  ir35: string | null;
  remote: string | null;
  min_rate: number | null;
  skills: string[];
}

function alertToSearch(a: Alert): string {
  const p = new URLSearchParams();
  if (a.q) p.set("q", a.q);
  if (a.ir35) p.set("ir35", a.ir35);
  if (a.remote) p.set("remote", a.remote);
  if (a.min_rate) p.set("min_rate", String(a.min_rate));
  if (a.skills.length) p.set("skills", a.skills.join(","));
  const qs = p.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}

function AlertsInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [busy, setBusy] = useState(true);

  // New-alert form (prefillable from ?prefill= query when arriving from board)
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [ir35, setIr35] = useState(searchParams.get("ir35") ?? "");
  const [remote, setRemote] = useState(searchParams.get("remote") ?? "");
  const [minRate, setMinRate] = useState(Number(searchParams.get("min_rate") ?? "0"));
  const [skills, setSkills] = useState<string[]>((searchParams.get("skills") ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  useEffect(() => {
    if (!loading && !user) router.replace("/account?next=/alerts");
  }, [user, loading, router]);

  // If arriving with prefilled params, open the form.
  useEffect(() => {
    if (searchParams.get("prefill") === "1") setShowForm(true);
  }, [searchParams]);

  const load = () => {
    if (!user) return;
    supabase
      .from("job_alerts")
      .select("id, name, q, ir35, remote, min_rate, skills")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: Alert[] | null }) => {
        setAlerts(data ?? []);
        setBusy(false);
      });
  };
  useEffect(load, [user]);

  const save = async () => {
    if (!user) return;
    await supabase.from("job_alerts").insert({
      user_id: user.id,
      name: name.trim() || "Untitled alert",
      q: q.trim() || null,
      ir35: ir35 || null,
      remote: remote || null,
      min_rate: minRate > 0 ? minRate : null,
      skills,
    });
    setShowForm(false);
    setName("");
    load();
  };

  const remove = async (id: string) => {
    if (!user) return;
    await supabase.from("job_alerts").delete().eq("id", id).eq("user_id", user.id);
    load();
  };

  if (loading || !user) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500"><Loader2 className="animate-spin" size={22} /></main>;
  }

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="text-green-600" size={22} />
          <h1 className="text-2xl font-semibold tracking-tight">Job alerts</h1>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700">
          <Plus size={15} /> New alert
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-slate-500">
        Save searches you care about. Each opens as a live search, and once email delivery is
        switched on, we&apos;ll notify you when new matching contracts appear.
      </p>

      {showForm && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-800">New alert</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Alert name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Outside IR35 React, £600+"
                className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Keyword</label>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. developer"
                className="w-full rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">IR35</label>
              <select value={ir35} onChange={(e) => setIr35(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
                <option value="">Any</option>
                <option value="outside">Outside IR35</option>
                <option value="inside">Inside IR35</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Workplace</label>
              <select value={remote} onChange={(e) => setRemote(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
                <option value="">Any</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Minimum day rate</label>
              <select value={minRate} onChange={(e) => setMinRate(Number(e.target.value))} className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 [&>option]:bg-white">
                {[0, 300, 400, 500, 600, 700].map((r) => <option key={r} value={r}>{r === 0 ? "Any" : `£${r}+/day`}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-medium text-slate-600">Skills</label>
            <div className="flex flex-wrap gap-1.5">
              {PROFILE_SKILL_OPTIONS.slice(0, 18).map((s) => {
                const active = skills.includes(s);
                return (
                  <button key={s} onClick={() => setSkills((prev) => active ? prev.filter((x) => x !== s) : [...prev, s])}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? "border-green-300 bg-green-50 text-green-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <button onClick={save} className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700">Save alert</button>
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400">Cancel</button>
          </div>
        </div>
      )}

      {busy ? (
        <div className="mt-16 flex justify-center text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
      ) : alerts.length === 0 && !showForm ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-slate-700">No alerts yet.</p>
          <p className="mt-1 text-sm text-slate-500">Create one to save a search you care about.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{a.name}</p>
                <p className="truncate text-sm text-slate-500">
                  {[a.ir35 && (a.ir35 === "outside" ? "Outside IR35" : "Inside IR35"), a.min_rate && `£${a.min_rate}+/day`, a.q, ...(a.skills ?? [])].filter(Boolean).join(" · ") || "Any contract"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link href={alertToSearch(a)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400">
                  Run <ArrowRight size={13} />
                </Link>
                <button onClick={() => remove(a.id)} aria-label="Delete alert" className="rounded-lg border border-slate-300 bg-white p-2 text-slate-400 hover:border-red-200 hover:text-red-600">
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function AlertsPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav />
      <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500"><Loader2 className="animate-spin" size={22} /></main>}>
        <AlertsInner />
      </Suspense>
    </div>
  );
}
