import { AlertTriangle, CheckCircle2, ShieldQuestion } from "lucide-react";
import type { JobListing } from "@/lib/job-types";

export function IR35Badge({
  status,
  size = "sm",
}: {
  status: JobListing["ir35_status"];
  size?: "xs" | "sm";
}) {
  const sizing = size === "xs" ? "min-h-6 px-2 text-[11px]" : "min-h-7 px-2.5 text-xs";
  if (status === "outside") {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 font-semibold text-green-800 ${sizing}`}>
        <CheckCircle2 size={size === "xs" ? 12 : 13} aria-hidden="true" /> Outside IR35
      </span>
    );
  }
  if (status === "inside") {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 font-semibold text-rose-700 ${sizing}`}>
        <AlertTriangle size={size === "xs" ? 12 : 13} aria-hidden="true" /> Inside IR35
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 font-semibold text-amber-800 ${sizing}`}>
      <ShieldQuestion size={size === "xs" ? 12 : 13} aria-hidden="true" /> IR35 TBC
    </span>
  );
}

