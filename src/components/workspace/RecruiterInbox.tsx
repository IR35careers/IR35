"use client";

import { useMemo, useState } from "react";
import { AtSign, CheckCircle2, Inbox, MailCheck, ShieldCheck } from "lucide-react";
import { WorkspacePage, StatusPill } from "@/components/workspace/WorkspacePage";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { InboxClassification, InboxMessage } from "@/lib/workspace/types";

const FILTERS: Array<{ id: "all" | InboxClassification; label: string }> = [
  { id: "all", label: "All" },
  { id: "interview", label: "Interviews" },
  { id: "action_required", label: "Needs you" },
  { id: "application_update", label: "Updates" },
  { id: "rejection", label: "Rejections" },
];

export function RecruiterInbox() {
  const workspace = useWorkspaceState();
  const [filter, setFilter] = useState<"all" | InboxClassification>("all");
  const visible = useMemo(() => workspace.messages.filter((message) => filter === "all" || message.classification === filter), [filter, workspace.messages]);
  const [selectedId, setSelectedId] = useState<string | null>(visible[0]?.id ?? null);
  const selected = workspace.messages.find((message) => message.id === selectedId) ?? visible[0] ?? null;

  const selectMessage = (message: InboxMessage) => {
    setSelectedId(message.id);
    if (!message.read) {
      updateWorkspace((current) => ({ ...current, messages: current.messages.map((item) => item.id === message.id ? { ...item, read: true } : item) }));
    }
  };

  const toggleForwarding = () => updateWorkspace((current) => ({ ...current, inbox: { ...current.inbox, forwardingEnabled: !current.inbox.forwardingEnabled } }));

  return (
    <WorkspacePage eyebrow="Recruiter inbox" title="Responses linked to the right role" description="A private application address can receive recruiter updates, classify them, and connect each message to its application. This local preview uses fictional messages and sends nothing.">
      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
          <div className="flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><AtSign size={20} /></span><div><p className="text-sm font-semibold text-slate-950">Your private application address</p><p className="mt-1 break-all font-mono text-sm text-brand-800">{workspace.inbox.alias}</p></div></div>
          <div className="mt-5 flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-medium text-slate-800">Forward to {workspace.inbox.forwardingEmail}</p><p className="text-xs text-slate-500">Preview setting only; no forwarding provider is connected.</p></div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${workspace.inbox.forwardingEnabled ? "bg-brand-50 text-brand-800" : "bg-slate-100 text-slate-600"}`}>{workspace.inbox.forwardingEnabled ? "Preview on" : "Preview off"}</span>
              <button type="button" role="switch" aria-label="Message forwarding preview" aria-checked={workspace.inbox.forwardingEnabled} onClick={toggleForwarding} className={`ir35-focus relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border p-1 shadow-inner transition-colors ${workspace.inbox.forwardingEnabled ? "border-brand-600 bg-brand-600" : "border-slate-300 bg-slate-200 hover:bg-slate-300"}`}><span className={`h-6 w-6 rounded-full bg-white shadow-sm ring-1 ring-slate-900/5 transition-transform ${workspace.inbox.forwardingEnabled ? "translate-x-6" : "translate-x-0"}`} /></button>
            </div>
          </div>
        </div>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><ShieldCheck className="text-amber-800" size={21} /><p className="mt-3 text-sm font-semibold text-amber-950">Provider gate</p><p className="mt-1 text-sm leading-6 text-amber-900">A production inbox needs an inbound domain, signed webhooks, encryption, retention controls and a forwarding provider.</p></div>
      </section>

      <div className="mt-6 flex flex-wrap gap-2" aria-label="Inbox filters">{FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`ir35-focus min-h-10 rounded-xl border px-4 text-sm font-semibold transition-colors ${filter === item.id ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-slate-300 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"}`}>{item.label}</button>)}</div>

      <section className="mt-4 grid min-h-[520px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card lg:grid-cols-[380px_1fr]">
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
              {selected.applicationId && <div className="mt-8 rounded-2xl border border-brand-200 bg-brand-50 p-4"><p className="flex items-center gap-2 text-sm font-semibold text-brand-900"><MailCheck size={16} /> Linked to {workspace.applications.find((item) => item.id === selected.applicationId)?.job.title ?? "an application"}</p><p className="mt-1 text-xs text-brand-800">Classification and linking are deterministic preview data until an inbound provider is connected.</p></div>}
            </article>
          ) : <div className="flex h-full items-center justify-center text-center"><div><CheckCircle2 className="mx-auto text-slate-300" size={32} /><p className="mt-3 text-sm text-slate-500">Choose a message to read it.</p></div></div>}
        </div>
      </section>
    </WorkspacePage>
  );
}
