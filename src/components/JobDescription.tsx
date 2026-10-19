import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { jobDescriptionKind, jobDescriptionSourceUrl, type JobDescriptionKind } from "@/lib/job-description";

type Props = { description: string; kind?: JobDescriptionKind; sourceUrl?: string };

/** Plain React text, no clamping, fixed-height scrollbox, HTML injection or text slicing. */
export function JobDescriptionText({ description, kind, sourceUrl }: Props) {
  const quality = jobDescriptionKind(description, kind);
  const original = jobDescriptionSourceUrl(sourceUrl);
  return (
    <div className="min-w-0 space-y-4" data-job-description={quality}>
      {quality !== "missing" && description && <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 [overflow-wrap:anywhere] sm:text-base sm:leading-8">{description}</div>}
      {quality === "source_text" ? (
        <p className="text-xs leading-5 text-slate-600">All available source text is shown. Check the original advert for any additional or updated details.</p>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          {quality === "summary" ? "The source supplied a summary, not a confirmed full advert. Review the original posting before applying."
            : quality === "limited" ? "This description exceeded the safe import limit. Only complete words are retained here; review the original posting for the remaining text."
              : "The source did not provide readable description text. Review the original posting before applying."}
        </p>
      )}
      {original ? <a href={original} target="_blank" rel="noopener noreferrer" className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">View original posting <ArrowUpRight size={15} aria-hidden="true" /></a>
        : quality !== "source_text" && <p className="text-xs leading-5 text-slate-600">An original posting link is not available in this record.</p>}
    </div>
  );
}

/** Native disclosure remains usable by keyboard/touch and without JavaScript. */
export function JobDescriptionDisclosure(props: Props & { open?: boolean; children?: ReactNode }) {
  return (
    <details open={props.open ?? true} className="group mt-4 min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="ir35-focus flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-900 sm:px-5">
        <span>Contract description <span className="ml-2 text-xs font-normal text-slate-600">Source text</span></span>
        <ChevronDown size={17} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t border-slate-200 px-4 py-4 sm:px-5"><JobDescriptionText {...props} />{props.children}</div>
    </details>
  );
}
