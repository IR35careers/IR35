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
      aria-label="IR35Careers home"
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
        <span className={`text-[15px] font-bold tracking-[-0.02em] ${tone === "dark" ? "text-white" : "text-slate-950"}`}>
          IR35<span className={`font-semibold ${tone === "dark" ? "text-slate-300" : "text-slate-600"}`}>Careers</span>
        </span>
      )}
    </Link>
  );
}
