import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      className="ir35-focus inline-flex min-h-11 items-center gap-2.5 rounded-xl"
      aria-label="IR35Careers home"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 shadow-sm">
        <BriefcaseBusiness size={17} strokeWidth={2.1} className="text-white" aria-hidden="true" />
      </span>
      {!compact && (
        <span className="text-[15px] font-bold tracking-[-0.02em] text-slate-950">
          IR35<span className="font-semibold text-slate-500">Careers</span>
        </span>
      )}
    </Link>
  );
}

