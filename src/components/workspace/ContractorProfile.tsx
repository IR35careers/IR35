"use client";

import { useState } from "react";
import { Building2, CheckCircle2, FileText, IdCard, ShieldCheck, UserRound } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { ContractorProfile as ContractorProfileType } from "@/lib/workspace/types";

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label className="text-sm font-semibold text-slate-800">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-normal text-slate-900" /></label>;
}

export function ContractorProfile() {
  const workspace = useWorkspaceState();
  const [profile, setProfile] = useState<ContractorProfileType>(workspace.profile);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof ContractorProfileType>(key: K, value: ContractorProfileType[K]) => setProfile((current) => ({ ...current, [key]: value }));
  const save = () => { updateWorkspace((current) => ({ ...current, profile, inbox: { ...current.inbox, forwardingEmail: profile.forwardingEmail } })); setSaved(true); };

  const completed = [profile.fullName, profile.email, profile.phone, profile.location, profile.defaultCvLabel, profile.availability].filter(Boolean).length;
  const completeness = Math.round((completed / 6) * 100);

  return (
    <WorkspacePage eyebrow="Contractor profile" title="Your evidence and application defaults" description="Keep reusable facts in one place so every role-specific packet starts from accurate information. Sensitive fields stay in this browser during local preview.">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><UserRound size={20} /></span><div><h2 className="font-semibold">Personal details</h2><p className="text-sm text-slate-600">Used only in application materials you approve.</p></div></div><div className="mt-6 grid gap-5 sm:grid-cols-2"><Field label="Full name" value={profile.fullName} onChange={(value) => set("fullName", value)} /><Field label="Email" type="email" value={profile.email} onChange={(value) => set("email", value)} /><Field label="Phone" value={profile.phone} onChange={(value) => set("phone", value)} /><Field label="Location" value={profile.location} onChange={(value) => set("location", value)} /><Field label="LinkedIn URL" type="url" value={profile.linkedInUrl} onChange={(value) => set("linkedInUrl", value)} /><Field label="Portfolio URL" type="url" value={profile.portfolioUrl} onChange={(value) => set("portfolioUrl", value)} /></div></section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><IdCard size={20} /></span><div><h2 className="font-semibold">Work authorisation and availability</h2><p className="text-sm text-slate-600">Never inferred from a CV or nationality.</p></div></div><div className="mt-6 grid gap-5 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-800">Right to work in the UK<select value={profile.rightToWork} onChange={(event) => set("rightToWork", event.target.value as ContractorProfileType["rightToWork"])} className="ir35-focus mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-normal"><option value="yes">Yes</option><option value="needs_sponsorship">Requires sponsorship</option><option value="no">No</option><option value="prefer_not_to_say">Prefer not to say</option></select></label><Field label="Availability" value={profile.availability} onChange={(value) => set("availability", value)} placeholder="e.g. Within two weeks" /><Field label="Notice period" value={profile.noticePeriod} onChange={(value) => set("noticePeriod", value)} /><Field label="Security clearance" value={profile.clearance} onChange={(value) => set("clearance", value)} placeholder="Do not claim a clearance you do not hold" /></div></section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-700"><Building2 size={20} /></span><div><h2 className="font-semibold">Limited company details</h2><p className="text-sm text-slate-600">Optional details for engagements where they are relevant.</p></div></div><div className="mt-6 grid gap-5 sm:grid-cols-2"><Field label="Company name" value={profile.limitedCompanyName} onChange={(value) => set("limitedCompanyName", value)} /><Field label="Companies House number" value={profile.companyNumber} onChange={(value) => set("companyNumber", value)} /><label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 text-sm font-semibold"><input type="checkbox" checked={profile.vatRegistered} onChange={(event) => set("vatRegistered", event.target.checked)} className="h-5 w-5 accent-emerald-700" /> VAT registered</label></div></section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><FileText size={20} /></span><div><h2 className="font-semibold">Documents and inbox</h2><p className="text-sm text-slate-600">Choose reusable labels and forwarding preferences.</p></div></div><div className="mt-6 grid gap-5 sm:grid-cols-2"><Field label="Default CV label" value={profile.defaultCvLabel} onChange={(value) => set("defaultCvLabel", value)} /><Field label="Forward recruiter messages to" type="email" value={profile.forwardingEmail} onChange={(value) => set("forwardingEmail", value)} /></div></section>

          <div className="flex items-center gap-4"><button type="button" onClick={save} className="ir35-focus inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-sm font-bold text-white hover:bg-brand-700"><CheckCircle2 size={17} /> Save profile</button>{saved && <p role="status" className="text-sm font-semibold text-emerald-700">Profile saved locally.</p>}</div>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-max"><section className="rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-card"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 text-xl font-bold text-white">{profile.fullName.trim().charAt(0) || "C"}</div><h2 className="mt-4 font-semibold text-slate-950">{profile.fullName || "Your profile"}</h2><p className="mt-1 text-sm text-slate-500">UK contractor workspace</p><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${completeness}%` }} /></div><p className="mt-2 text-xs font-semibold text-slate-600">{completeness}% core details complete</p></section><section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5"><ShieldCheck className="text-emerald-700" /><h2 className="mt-3 font-semibold text-emerald-950">Truth-first defaults</h2><p className="mt-1 text-sm leading-6 text-emerald-900">Work authorisation, clearance and company details are never guessed. Each application still requires review.</p></section></aside>
      </div>
    </WorkspacePage>
  );
}
