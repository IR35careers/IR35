"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { applicationAuthJobId } from "@/lib/auth-routing";

const jobSchema = z.object({ job: z.object({ id: z.uuid(), title: z.string().trim().min(1).max(500), company_name: z.string().trim().min(1).max(300) }) });

export function ApplicationSignInContext({ next }: { next: string }) {
  const id = applicationAuthJobId(next);
  const [context, setContext] = useState<{ id: string; title: string; company_name: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    void fetch(`/api/jobs/${id}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const parsed = jobSchema.safeParse(await response.json());
      if (!controller.signal.aborted && parsed.success && parsed.data.job.id.toLowerCase() === id.toLowerCase()) setContext(parsed.data.job);
    }).catch(() => {}).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id]);
  if (!id) return null;
  return <p role="status" className="mt-4 break-words rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">{context?.id.toLowerCase() === id.toLowerCase() ? <>Sign in to apply to <strong>{context.title}</strong> at <strong>{context.company_name}</strong>. We’ll return you to this contract after sign-in.</> : "Sign in to return to your selected contract. If the listing has closed, we’ll show its availability rather than submit an application."}</p>;
}
