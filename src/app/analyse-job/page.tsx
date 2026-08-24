"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, Link2, Loader2, ShieldCheck, WandSparkles } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { ResumeStudio } from "@/components/resume/ResumeStudio";
import { IR35Badge } from "@/components/ui/ir35-badge";
import { buttonClassName } from "@/components/ui/button";
import { formatRate, type JobDetail } from "@/lib/job-types";
import { deriveIR35Provenance } from "@/lib/ir35-provenance";

export default function AnalyseExternalJobPage() {
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<JobDetail | null>(null);
  const [studio, setStudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const supplied = new URLSearchParams(window.location.search).get("url");
    if (supplied?.startsWith("https://")) setUrl(supplied);
  }, []);

  const analyse = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setJob(null);
    try {
      const response = await fetch("/api/jobs/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const payload = (await response.json()) as { job?: JobDetail; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? "The job page could not be analysed.");
      setJob(payload.job);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "The job page could not be analysed.");
    } finally {
      setBusy(false);
    }
  };

  if (job && studio) {
    return <div className="min-h-screen bg-slate-50"><PublicHeader /><ResumeStudio job={job} backHref="/analyse-job" forceLocalHistory /><PublicFooter /></div>;
  }

  return <div className="min-h-screen bg-slate-50"><PublicHeader /><main>
    <header className="border-b border-slate-200 bg-white"><div className="ir35-container py-12 sm:py-16"><div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Bring your own role</p><h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] text-slate-950 sm:text-5xl">Paste a job. Check the evidence. Tailor your Resume.</h1><p className="mt-5 text-base leading-7 text-slate-600">Analyse a public HTTPS job page without adding it to the IR35Careers index. We look for structured job data, keep the original source and never treat an absent IR35 statement as Outside.</p></div></div></header>
    <section className="ir35-container py-10 sm:py-14">
      <form onSubmit={analyse} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-7">
        <label htmlFor="job-url" className="text-sm font-bold text-slate-900">Public job URL</label>
        <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_auto]"><div className="relative"><Link2 size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" /><input id="job-url" type="url" inputMode="url" required value={url} onChange={(event)=>setUrl(event.target.value)} placeholder="https://company.example/jobs/contract-role" className="ir35-focus min-h-14 w-full rounded-xl border border-slate-300 pl-11 pr-4 text-sm" /></div><button disabled={busy} className={buttonClassName({size:"lg",className:"w-full lg:w-auto"})}>{busy ? <Loader2 className="animate-spin" size={17} /> : <WandSparkles size={17} />} Analyse job</button></div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck size={14} className="mt-0.5 shrink-0" />Private networks, oversized pages, non-HTML files and unsafe redirects are blocked. The page text is treated as untrusted job content.</p>
        {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      </form>

      {job && <article className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card"><div className="grid gap-6 p-6 lg:grid-cols-[1fr_260px] lg:p-8"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">External job preview</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{job.title}</h2><p className="mt-2 text-sm text-slate-600">{job.company_name} · {job.location}</p><div className="mt-4 flex flex-wrap gap-2">{job.skills.slice(0,12).map((skill)=><span key={skill} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{skill}</span>)}</div><p className="mt-5 max-h-60 overflow-y-auto whitespace-pre-line pr-3 text-sm leading-6 text-slate-600">{job.description}</p></div><aside className="h-max rounded-2xl border border-slate-200 bg-slate-50 p-5"><p className="text-xl font-bold text-slate-950">{formatRate(job)}</p><div className="mt-3"><IR35Badge status={job.ir35_status} /></div><p className="mt-2 text-xs leading-5 text-slate-500">{deriveIR35Provenance(job).shortLabel}</p><p className="mt-4 text-xs text-slate-500">Source: {job.source_domain}</p><div className="mt-5 space-y-2"><button type="button" onClick={()=>setStudio(true)} className={buttonClassName({className:"w-full"})}>Tailor Resume locally <ArrowRight size={15} /></button><a href={job.apply_url} target="_blank" rel="noopener noreferrer" className={buttonClassName({variant:"secondary",className:"w-full"})}>Open original <ExternalLink size={14} /></a></div><p className="mt-4 text-[11px] leading-5 text-slate-500">For an external role, Resume versions stay in this browser so a third-party URL cannot create an unreviewed cloud record.</p></aside></div></article>}
      <p className="mt-8 text-sm text-slate-600">Prefer indexed, freshness-checked roles? <Link href="/jobs" className="font-bold text-brand-700 underline">Browse UK contracts</Link>.</p>
    </section>
  </main><PublicFooter /></div>;
}
