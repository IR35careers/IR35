"use client";

import { useEffect, useMemo, useState } from "react";
import { AtSign, Check, CheckCircle2, Copy, Inbox, Loader2, MailCheck, ShieldCheck } from "lucide-react";
import { WorkspacePage, StatusPill } from "@/components/workspace/WorkspacePage";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { getSupabase } from "@/lib/supabase";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { InboxClassification, InboxMessage } from "@/lib/workspace/types";

const FILTERS: Array<{ id: "all" | InboxClassification; label: string }> = [
  { id: "all", label: "All" },
  { id: "interview", label: "Interviews" },
  { id: "action_required", label: "Needs you" },
  { id: "application_update", label: "Updates" },
  { id: "rejection", label: "Rejections" },
];

type EmailState = "loading" | "preview" | "connected" | "gated" | "error";

export function RecruiterInbox() {
  const workspace = useWorkspaceState();
  const [filter, setFilter] = useState<"all" | InboxClassification>("all");
  const [emailState, setEmailState] = useState<EmailState>(isSupabaseConfigured() ? "loading" : "preview");
  const [activating, setActivating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const visible = useMemo(() => workspace.messages.filter((message) => filter === "all" || message.classification === filter), [filter, workspace.messages]);
  const [selectedId, setSelectedId] = useState<string | null>(visible[0]?.id ?? null);
  const selected = workspace.messages.find((message) => message.id === selectedId) ?? visible[0] ?? null;
  const hasAlias = workspace.inbox.alias !== "Not created" && workspace.inbox.providerState === "connected";

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    void getSupabase().auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!token) throw new Error("No active session");
      const response = await fetch("/api/integrations/status", { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Status unavailable");
      const payload = (await response.json()) as { integrations?: Array<{ id: string; state: string }> };
      const email = payload.integrations?.find((item) => item.id === "inbound_email");
      if (active) setEmailState(email?.state === "connected" ? "connected" : "gated");
    }).catch(() => { if (active) setEmailState("error"); });
    return () => { active = false; };
  }, []);

  const selectMessage = (message: InboxMessage) => {
    setSelectedId(message.id);
    if (!message.read) updateWorkspace((current) => ({ ...current, messages: current.messages.map((item) => item.id === message.id ? { ...item, read: true } : item) }));
  };

  const activateInbox = async () => {
    setActivating(true);
    setNotice(null);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again to activate your inbox.");
      const response = await fetch("/api/integrations/email/alias", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const payload = (await response.json()) as { alias?: string; forwardingEmail?: string; error?: string };
      if (!response.ok || !payload.alias) throw new Error(payload.error ?? "The inbox could not be activated.");
      updateWorkspace((current) => ({ ...current, inbox: { ...current.inbox, alias: payload.alias as string, forwardingEmail: payload.forwardingEmail ?? current.inbox.forwardingEmail, forwardingEnabled: false, providerState: "connected" } }));
      setNotice("Your private recruiter address is ready.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The inbox could not be activated.");
    } finally {
      setActivating(false);
    }
  };

  const copyAlias = async () => {
    await navigator.clipboard.writeText(workspace.inbox.alias);
    setNotice("Private address copied.");
  };

  return (
    <WorkspacePage eyebrow="Recruiter inbox" title="Responses linked to the right role" description="Use one private address for applications. Recruiter replies are classified and attached to the correct contract so the next action stays clear.">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card" aria-labelledby="inbox-connection-title">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${emailState === "connected" && hasAlias ? "bg-emerald-50 text-emerald-700" : "bg-brand-50 text-brand-700"}`}><AtSign size={20} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="inbox-connection-title" className="text-sm font-semibold text-slate-950">Private application address</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${emailState === "connected" && hasAlias ? "bg-emerald-50 text-emerald-800" : emailState === "preview" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                    {emailState === "loading" ? "Checking" : emailState === "connected" && hasAlias ? "Active" : emailState === "preview" ? "Preview" : "Not connected"}
                  </span>
                </div>
                {emailState === "loading" ? <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="animate-spin" size={14} /> Checking email connection…</p> : hasAlias || emailState === "preview" ? <p className="mt-2 break-all font-mono text-sm font-semibold text-brand-800">{workspace.inbox.alias}</p> : <p className="mt-2 text-sm leading-6 text-slate-600">No address has been issued. Recruiter email is not being received by IR35Careers.</p>}
              </div>
            </div>

            <div className="mt-5 border-t border-slate-100 pt-5">
              {emailState === "connected" && !hasAlias && <button type="button" onClick={() => void activateInbox()} disabled={activating} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">{activating ? <Loader2 className="animate-spin" size={16} /> : <MailCheck size={16} />} Activate private inbox</button>}
              {(hasAlias || emailState === "preview") && <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-slate-800">Use this address on applications</p><p className="mt-1 text-xs leading-5 text-slate-500">Messages appear here. Personal-email forwarding stays off until outbound delivery is separately verified.</p></div><button type="button" onClick={() => void copyAlias()} className="ir35-focus inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-brand-300 hover:bg-brand-50">{notice === "Private address copied." ? <Check size={15} /> : <Copy size={15} />} Copy address</button></div>}
              {(emailState === "gated" || emailState === "error") && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><p className="font-semibold">Email setup is incomplete</p><p className="mt-1 leading-6">Connect a verified inbound domain, signed webhook and delivery provider before users can activate an address.</p></div>}
              {notice && <p className="mt-3 text-sm font-medium text-brand-800" role="status">{notice}</p>}
            </div>
          </div>
          <aside className="border-t border-slate-200 bg-slate-950 p-5 text-white lg:border-l lg:border-t-0 sm:p-6">
            <ShieldCheck className="text-emerald-300" size={21} aria-hidden="true" />
            <h2 className="mt-4 font-semibold">What this inbox does</h2>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
              <li>Links replies to the originating application.</li>
              <li>Surfaces interviews and actions that need you.</li>
              <li>Keeps sender, subject and message history private to your account.</li>
            </ul>
          </aside>
        </div>
      </section>

      <div className="mt-6 flex flex-wrap gap-2" aria-label="Inbox filters">{FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`ir35-focus min-h-10 rounded-xl border px-4 text-sm font-semibold transition-colors ${filter === item.id ? "border-slate-950 bg-slate-950 text-white shadow-sm" : "border-slate-300 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"}`}>{item.label}</button>)}</div>

      <section className="mt-4 grid min-h-[520px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card lg:grid-cols-[360px_1fr]">
        <div className="border-b border-slate-200 lg:border-b-0 lg:border-r">
          {visible.length === 0 ? <div className="p-8 text-center"><Inbox className="mx-auto text-slate-400" /><p className="mt-3 text-sm text-slate-600">No messages in this view.</p></div> : visible.map((message) => (
            <button key={message.id} type="button" onClick={() => selectMessage(message)} className={`ir35-focus block w-full border-b border-slate-100 p-4 text-left transition-colors ${selected?.id === message.id ? "bg-brand-50" : "hover:bg-slate-50"}`}>
              <div className="flex items-center justify-between gap-2"><span className={`truncate text-xs ${message.read ? "text-slate-500" : "font-bold text-slate-900"}`}>{message.from}</span>{!message.read && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}</div>
              <p className={`mt-1 truncate text-sm ${message.read ? "font-medium text-slate-700" : "font-bold text-slate-950"}`}>{message.subject}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{message.preview}</p>
              <div className="mt-2"><StatusPill status={message.classification} /></div>
            </button>
          ))}
        </div>
        <div className="min-w-0 p-5 sm:p-8">
          {selected ? (
            <article>
              <div className="flex flex-col gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between"><div><StatusPill status={selected.classification} /><h2 className="mt-3 text-xl font-semibold text-slate-950">{selected.subject}</h2><p className="mt-1 text-sm text-slate-500">From {selected.from}</p></div><p className="text-xs text-slate-500">{new Date(selected.receivedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p></div>
              <div className="mt-6 whitespace-pre-line text-sm leading-7 text-slate-700">{selected.body}</div>
              {selected.applicationId && <div className="mt-8 rounded-2xl border border-brand-200 bg-brand-50 p-4"><p className="flex items-center gap-2 text-sm font-semibold text-brand-900"><MailCheck size={16} /> Linked to {workspace.applications.find((item) => item.id === selected.applicationId)?.job.title ?? "an application"}</p><p className="mt-1 text-xs text-brand-800">The message and next action stay attached to this contract.</p></div>}
            </article>
          ) : <div className="flex h-full items-center justify-center text-center"><div><CheckCircle2 className="mx-auto text-slate-300" size={32} /><p className="mt-3 text-sm text-slate-500">Choose a message to read it.</p></div></div>}
        </div>
      </section>
    </WorkspacePage>
  );
}
