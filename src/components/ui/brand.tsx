import Link from "next/link";
import Image from "next/image";

type BrandProps = {
  href?: string;
  compact?: boolean;
  tone?: "light" | "dark";
};

export function Brand({ href = "/", compact = false, tone = "light" }: BrandProps) {
  return (
    <Link
      href={href}
      className="ir35-focus inline-flex min-h-11 items-center gap-2.5 rounded-xl"
      aria-label="IR35Careers public beta home"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1 ${
          tone === "dark"
            ? "bg-white shadow-sm ring-white/20"
            : "bg-emerald-50 shadow-sm ring-emerald-100"
        }`}
        aria-hidden="true"
      >
        <Image
          src="/images/generated/brand/ir35careers-mark-256.png"
          alt=""
          width={40}
          height={40}
          sizes="40px"
          className="h-10 w-10 object-contain"
          priority
        />
      </span>
      {!compact && (
        <span className="flex items-center gap-2">
          <span className={`text-[15px] font-bold tracking-[-0.02em] ${tone === "dark" ? "text-white" : "text-slate-950"}`}>
            IR35<span className={`font-semibold ${tone === "dark" ? "text-slate-300" : "text-slate-600"}`}>Careers</span>
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${tone === "dark" ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
            Beta
          </span>
        </span>
      )}
    </Link>
  );
}
