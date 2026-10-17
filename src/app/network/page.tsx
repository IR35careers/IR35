"use client";

import { useMemo, useState } from "react";
import { Check, Clipboard, Download, Plus, Send, Trash2, UserRoundPlus, UsersRound } from "lucide-react";
import { WorkspacePage, StatusPill } from "@/components/workspace/WorkspacePage";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import { buildReferralDraft, countDueFollowUps } from "@/lib/workspace/network";
import type { NetworkContact, NetworkContactStage, ReferralRequest, ReferralRequestStatus } from "@/lib/workspace/types";

const STAGES: NetworkContactStage[] = ["identified", "warm", "asked", "referred", "closed"];
const REQUEST_STATES: ReferralRequestStatus[] = ["draft", "reviewed", "copied", "responded"];

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function NetworkPage() {
  const workspace = useWorkspaceState();
  const contacts = useMemo(() => workspace.profile.networkContacts ?? [], [workspace.profile.networkContacts]);
  const requests = workspace.profile.referralRequests ?? [];
  const [showContactForm, setShowContactForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [contactDraft, setContactDraft] = useState({ name: "", company: "", role: "", relationship: "", channel: "LinkedIn", notes: "", nextFollowUp: "" });
  const [selectedContactId, setSelectedContactId] = useState(contacts[0]?.id ?? "");
  const [selectedApplicationId, setSelectedApplicationId] = useState(workspace.applications[0]?.id ?? "manual");
  const selectedApplication = workspace.applications.find((item) => item.id === selectedApplicationId);
  const [manualRole, setManualRole] = useState("");
  const [manualCompany, setManualCompany] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState(false);

  const dueCount = useMemo(() => countDueFollowUps(contacts), [contacts]);

  const persist = (nextContacts: NetworkContact[], nextRequests: ReferralRequest[]) => {
    updateWorkspace((current) => ({
      ...current,
      profile: { ...current.profile, networkContacts: nextContacts, referralRequests: nextRequests },
    }));
  };

  const addContact = () => {
    if (!contactDraft.name.trim()) return;
    const timestamp = new Date().toISOString();
    const contact: NetworkContact = {
      id: uid("contact"),
      ...contactDraft,
      name: contactDraft.name.trim(),
      company: contactDraft.company.trim(),
      role: contactDraft.role.trim(),
      relationship: contactDraft.relationship.trim(),
      notes: contactDraft.notes.trim(),
      stage: "identified",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    persist([contact, ...contacts], requests);
    setSelectedContactId(contact.id);
    setContactDraft({ name: "", company: "", role: "", relationship: "", channel: "LinkedIn", notes: "", nextFollowUp: "" });
    setShowContactForm(false);
    setNotice("Contact saved.");
  };

  const updateContact = (id: string, patch: Partial<NetworkContact>) => {
    persist(contacts.map((contact) => contact.id === id ? { ...contact, ...patch, updatedAt: new Date().toISOString() } : contact), requests);
  };

  const removeContact = (id: string) => {
    persist(contacts.filter((contact) => contact.id !== id), requests.filter((request) => request.contactId !== id));
    if (selectedContactId === id) setSelectedContactId("");
  };

  const buildDraft = () => {
    const contact = contacts.find((item) => item.id === selectedContactId);
    if (!contact) return;
    const jobTitle = selectedApplication?.job.title || manualRole.trim() || "contract role";
    const company = selectedApplication?.job.company_name || manualCompany.trim() || "your organisation";
    setMessage(buildReferralDraft({ contact, jobTitle, company, senderName: workspace.profile.fullName }));
    setReviewed(false);
  };

  const saveRequest = async (copy: boolean) => {
    const contact = contacts.find((item) => item.id === selectedContactId);
    if (!contact || !message.trim() || !reviewed) return;
    const timestamp = new Date().toISOString();
    const request: ReferralRequest = {
      id: uid("referral"),
      contactId: contact.id,
      jobId: selectedApplication?.job.id || "",
      jobTitle: selectedApplication?.job.title || manualRole.trim(),
      company: selectedApplication?.job.company_name || manualCompany.trim(),
      listingUrl: selectedApplication ? `https://www.ir35careers.com/jobs/${selectedApplication.job.id}` : manualUrl.trim(),
      message: message.trim(),
      status: copy ? "copied" : "reviewed",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (copy) await navigator.clipboard.writeText(request.message);
    persist(contacts.map((item) => item.id === contact.id ? { ...item, stage: "asked", updatedAt: timestamp } : item), [request, ...requests]);
    setMessage("");
    setReviewed(false);
    setNotice(copy ? "Reviewed draft copied. IR35Careers did not send it." : "Reviewed referral draft saved.");
  };

  const updateRequest = (id: string, status: ReferralRequestStatus) => {
    persist(contacts, requests.map((request) => request.id === id ? { ...request, status, updatedAt: new Date().toISOString() } : request));
  };

  return (
    <WorkspacePage
      accountSection="referrals"
      eyebrow="Network and referrals"
      title="Turn real relationships into thoughtful outreach"
      description="Track people you actually know, prepare role-specific referral requests and choose where to send them. IR35Careers never contacts anyone for you."
      actions={<button type="button" onClick={() => downloadJson({ contacts, referralRequests: requests }, `ir35careers-network-${today()}.json`)} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700"><Download size={16} /> Export</button>}
    >
      {notice && <p className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900" role="status">{notice}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        {[["Contacts", contacts.length], ["Follow-ups due", dueCount], ["Referral drafts", requests.length]].map(([label, value]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-slate-600">{label}</p><p className="mt-2 text-3xl font-bold tabular-nums text-slate-950">{value}</p></article>)}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]">
        <section className="scroll-mt-24 rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
          <div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><UsersRound size={19} className="text-brand-700" /> Relationship map</h2><p className="mt-1 text-sm text-slate-600">Only add people you have a legitimate reason to contact.</p></div><button type="button" onClick={() => setShowContactForm((value) => !value)} className="ir35-focus scroll-mb-24 scroll-mt-28 inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white"><Plus size={15} /> Add</button></div>
          {showContactForm && <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
            <input aria-label="Contact name" value={contactDraft.name} onChange={(event) => setContactDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Name (required)" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" />
            <input aria-label="Contact company" value={contactDraft.company} onChange={(event) => setContactDraft((current) => ({ ...current, company: event.target.value }))} placeholder="Company" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" />
            <input aria-label="Contact role" value={contactDraft.role} onChange={(event) => setContactDraft((current) => ({ ...current, role: event.target.value }))} placeholder="Role" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" />
            <input aria-label="Relationship" value={contactDraft.relationship} onChange={(event) => setContactDraft((current) => ({ ...current, relationship: event.target.value }))} placeholder="How you know them" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" />
            <input aria-label="Contact channel" value={contactDraft.channel} onChange={(event) => setContactDraft((current) => ({ ...current, channel: event.target.value }))} placeholder="Channel, e.g. LinkedIn" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm" />
            <label className="text-xs font-bold text-slate-600">Next follow-up<input type="date" value={contactDraft.nextFollowUp} onChange={(event) => setContactDraft((current) => ({ ...current, nextFollowUp: event.target.value }))} className="ir35-focus mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal" /></label>
            <textarea aria-label="Contact notes" value={contactDraft.notes} onChange={(event) => setContactDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Private context and boundaries" className="ir35-focus min-h-24 rounded-xl border border-slate-300 bg-white p-3 text-sm sm:col-span-2" />
            <div className="flex gap-2 pb-2 sm:col-span-2"><button type="button" onClick={addContact} disabled={!contactDraft.name.trim()} className="ir35-focus scroll-mb-24 scroll-mt-28 min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-40">Save contact</button><button type="button" onClick={() => setShowContactForm(false)} className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold">Cancel</button></div>
          </div>}
          <div className="mt-5 space-y-3">{contacts.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">No contacts yet. Add someone you genuinely know.</div> : contacts.map((contact) => <article key={contact.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-bold text-slate-950">{contact.name}</p><p className="truncate text-sm text-slate-600">{[contact.role, contact.company].filter(Boolean).join(" · ") || "Relationship contact"}</p><p className="mt-2 text-xs text-slate-500">{[contact.relationship, contact.channel].filter(Boolean).join(" · ")}</p></div><button type="button" onClick={() => removeContact(contact.id)} aria-label={`Delete ${contact.name}`} className="ir35-focus rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 size={15} /></button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Stage<select value={contact.stage} onChange={(event) => updateContact(contact.id, { stage: event.target.value as NetworkContactStage })} className="ir35-focus mt-1 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{STAGES.map((stage) => <option key={stage} value={stage}>{stage.replaceAll("_", " ")}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Next follow-up<input type="date" value={contact.nextFollowUp} onChange={(event) => updateContact(contact.id, { nextFollowUp: event.target.value })} className="ir35-focus mt-1 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal" /></label></div>{contact.notes && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">{contact.notes}</p>}</article>)}</div>
        </section>

        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><h2 className="flex items-center gap-2 text-lg font-bold"><UserRoundPlus size={19} className="text-brand-700" /> Referral request builder</h2><p className="mt-1 text-sm leading-6 text-slate-600">Draft from known facts, edit freely, then confirm you reviewed it.</p><div className="mt-5 space-y-4"><label className="block text-sm font-bold text-slate-800">Contact<select value={selectedContactId} onChange={(event) => setSelectedContactId(event.target.value)} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-normal"><option value="">Choose a contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.company ? ` · ${contact.company}` : ""}</option>)}</select></label><label className="block text-sm font-bold text-slate-800">Role<select value={selectedApplicationId} onChange={(event) => setSelectedApplicationId(event.target.value)} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-normal"><option value="manual">Enter another role</option>{workspace.applications.map((application) => <option key={application.id} value={application.id}>{application.job.title} · {application.job.company_name}</option>)}</select></label>{selectedApplicationId === "manual" && <div className="grid gap-3"><input aria-label="Role title" value={manualRole} onChange={(event) => setManualRole(event.target.value)} placeholder="Role title" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" /><input aria-label="Role company" value={manualCompany} onChange={(event) => setManualCompany(event.target.value)} placeholder="Company" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" /><input aria-label="Listing URL" type="url" value={manualUrl} onChange={(event) => setManualUrl(event.target.value)} placeholder="Public listing URL (optional)" className="ir35-focus min-h-11 rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm" /></div>}<button type="button" onClick={buildDraft} disabled={!selectedContactId} className="ir35-focus min-h-11 rounded-xl border border-brand-300 bg-brand-50 px-4 text-sm font-bold text-brand-800 disabled:opacity-40">Create truth-safe draft</button>{message && <><textarea aria-label="Referral message" value={message} onChange={(event) => { setMessage(event.target.value); setReviewed(false); }} className="ir35-focus min-h-56 w-full rounded-2xl border border-slate-300 bg-white p-4 text-sm leading-6" /><label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="mt-1 h-5 w-5 accent-emerald-700" /><span><strong>I reviewed this message.</strong> The relationship, role and claims are accurate, and I will choose the external channel myself.</span></label><div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => void saveRequest(false)} disabled={!reviewed} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold disabled:opacity-40"><Check size={15} /> Save reviewed</button><button type="button" onClick={() => void saveRequest(true)} disabled={!reviewed} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-40"><Clipboard size={15} /> Copy for sending</button></div></>}</div></section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><h2 className="flex items-center gap-2 text-lg font-bold"><Send size={18} className="text-brand-700" /> Referral history</h2><div className="mt-4 space-y-3">{requests.length === 0 ? <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">No referral drafts saved.</p> : requests.map((request) => <article key={request.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-2"><div><p className="font-bold text-slate-950">{request.jobTitle || "Role not named"}</p><p className="text-sm text-slate-600">{request.company || contacts.find((item) => item.id === request.contactId)?.company || "Company not named"}</p></div><StatusPill status={request.status} /></div><p className="mt-3 line-clamp-3 whitespace-pre-line text-xs leading-5 text-slate-600">{request.message}</p><label className="mt-3 block text-xs font-bold text-slate-600">Update outcome<select value={request.status} onChange={(event) => updateRequest(request.id, event.target.value as ReferralRequestStatus)} className="ir35-focus mt-1 min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal">{REQUEST_STATES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label></article>)}</div></section>
        </div>
      </div>
    </WorkspacePage>
  );
}
