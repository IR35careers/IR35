import { CalendarClock, CircleAlert, ScanSearch, ShieldCheck } from "lucide-react";
import { deriveIR35Provenance } from "@/lib/ir35-provenance";
import type { JobDetail } from "@/lib/job-types";

const styles = {
  advertised: { icon: ShieldCheck, shell: "border-emerald-200 bg-emerald-50/60", iconStyle: "bg-emerald-100 text-emerald-800" },
  inferred: { icon: ScanSearch, shell: "border-amber-200 bg-amber-50/60", iconStyle: "bg-amber-100 text-amber-800" },
  source_or_review: { icon: ScanSearch, shell: "border-sky-200 bg-sky-50/60", iconStyle: "bg-sky-100 text-sky-800" },
  unconfirmed: { icon: CircleAlert, shell: "border-slate-300 bg-slate-50", iconStyle: "bg-slate-200 text-slate-700" },
} as const;

export function IR35EvidencePanel({ job, compact = false }: { job: JobDetail; compact?: boolean }) {
  const provenance = deriveIR35Provenance(job);
  const style = styles[provenance.kind];
  const Icon = style.icon;

  if (compact) {
    return (
      <section aria-labelledby="ir35-evidence-heading" className={`rounded-2xl border p-4 ${style.shell}`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.iconStyle}`}>
            <Icon size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">IR35 evidence</p>
            <h2 id="ir35-evidence-heading" className="mt-0.5 text-sm font-bold text-slate-950">{provenance.label}</h2>
          </div>
        </div>
        <details className="mt-3 border-t border-black/5 pt-3">
          <summary className="ir35-focus min-h-9 cursor-pointer list-none rounded-lg text-xs font-bold text-slate-700 marker:content-none">Why this status</summary>
          <div className="mt-2 space-y-3 text-xs leading-5 text-slate-700">
            <p>{provenance.explanation}</p>
            {provenance.evidence && <blockquote className="rounded-lg bg-white/80 px-3 py-2 font-semibold text-slate-800">{provenance.evidence}</blockquote>}
            <p className="inline-flex items-center gap-1.5 text-slate-600"><CalendarClock size={13} aria-hidden="true" />{provenance.observedLabel} · {provenance.confidenceLabel}</p>
            <p className="text-slate-600">Source: {job.source_domain.replace("www.", "")}</p>
          </div>
        </details>
      </section>
    );
  }

  return (
    <section aria-labelledby="ir35-evidence-heading" className={`rounded-2xl border p-5 ${style.shell}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.iconStyle}`}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-600">IR35 evidence</p>
          <h2 id="ir35-evidence-heading" className="mt-1 text-base font-bold text-slate-950">{provenance.label}</h2>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{provenance.explanation}</p>
      {provenance.evidence && (
        <blockquote className="mt-3 rounded-xl border border-black/5 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-800">
          “{provenance.evidence}”
        </blockquote>
      )}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-black/5 pt-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><CalendarClock size={14} aria-hidden="true" />{provenance.observedLabel}</span>
        <span>{provenance.confidenceLabel}</span>
      </div>
    </section>
  );
}
