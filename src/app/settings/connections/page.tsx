"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BriefcaseBusiness, CheckCircle2, CircleAlert, Inbox, Loader2, LockKeyhole, Send, ShieldCheck } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { getSupabase } from "@/lib/supabase";
import { useWorkspaceState } from "@/lib/workspace/store";

type CapabilityState = "available" | "connected" | "provider_gate" | "not_configured";
type Capability = { id: string; state: CapabilityState };

function Status({ ready, label }: { ready: boolean; label: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{ready ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{label}</span>;
}

export default function AccountConnectionsPage() {
  const workspace = useWorkspaceState();
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getSupabase().auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!token) throw new Error("No active session");
      const response = await fetch("/api/integrations/status", { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json() as { integrations?: Capability[] };
      if (active && response.ok) setCapabilities(payload.integrations ?? []);
    }).catch(() => undefined).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const states = useMemo(() => new Map(capabilities.map((item) => [item.id, item.state])), [capabilities]);
  const emailReady = states.get("inbound_email") === "connected" && workspace.inbox.providerState === "connected";
  const runnerReady = states.get("ats_submission") === "connected";
  const discoveryReady = states.get("reed") === "connected" || states.get("adzuna") === "connected";

  return (
    <WorkspacePage eyebrow="Account connections" title="Services connected to your workspace" description="See what IR35Careers uses for job discovery, applications and recruiter replies. No employer password is stored here.">
      {loading ? <div className="flex min-h-52 items-center justify-center rounded-3xl border border-slate-200 bg-white text-slate-500"><Loader2 className="animate-spin" size={22} /><span className="sr-only">Checking connections</span></div> : (
        <div className="grid gap-5 lg:grid-cols-3">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
            <div className="flex items-start justify-between gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><BriefcaseBusiness size={22} /></span><Status ready={discoveryReady} label={discoveryReady ? "Included" : "Limited"} /></div>
            <h2 className="mt-5 text-lg font-bold text-slate-950">Contract discovery</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Public UK contract sources are included automatically. You do not need to connect or share a job-board account.</p>
            <Link href="/jobs" className="ir35-focus mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-bold text-white">Browse contracts</Link>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
            <div className="flex items-start justify-between gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Inbox size={22} /></span><Status ready={emailReady} label={emailReady ? "Connected" : "Set up required"} /></div>
            <h2 className="mt-5 text-lg font-bold text-slate-950">Application email</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Employer replies are linked to the correct application and can be forwarded to your account email.</p>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Your private address</p><p className="mt-1 break-all font-mono text-sm font-semibold text-slate-900">{workspace.inbox.alias || "Not created"}</p></div>
            <Link href="/inbox" className="ir35-focus mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-800">Open recruiter inbox</Link>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
            <div className="flex items-start justify-between gap-4"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><Send size={22} /></span><Status ready={runnerReady} label={runnerReady ? "Ready" : "Role dependent"} /></div>
            <h2 className="mt-5 text-lg font-bold text-slate-950">Application runner</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">IR35Careers can complete supported public employer forms using only the profile, CV and answers you approved.</p>
            <Link href="/automation" className="ir35-focus mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-800">Manage Auto Apply</Link>
          </article>
        </div>
      )}

      <section className="mt-6 grid gap-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 sm:grid-cols-3">
        <div><ShieldCheck className="text-emerald-700" size={19} /><h2 className="mt-3 text-sm font-bold text-emerald-950">Your approval</h2><p className="mt-1 text-xs leading-5 text-emerald-900">Applications use your approved materials and saved consent.</p></div>
        <div><LockKeyhole className="text-emerald-700" size={19} /><h2 className="mt-3 text-sm font-bold text-emerald-950">Protected steps pause</h2><p className="mt-1 text-xs leading-5 text-emerald-900">Login, CAPTCHA and identity checks always return to you.</p></div>
        <div><Inbox className="text-emerald-700" size={19} /><h2 className="mt-3 text-sm font-bold text-emerald-950">Replies stay organised</h2><p className="mt-1 text-xs leading-5 text-emerald-900">Recruiter messages remain linked to the relevant role.</p></div>
      </section>
    </WorkspacePage>
  );
}
