"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Preserve old onboarding links while keeping one application-profile source
 * of truth. The profile page now owns CV extraction, reusable answers and the
 * readiness gate used by the application runner.
 */
export default function OnboardingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/profile#application-readiness");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
      <p className="inline-flex items-center gap-2 text-sm font-semibold" role="status">
        <Loader2 className="animate-spin" size={18} /> Opening your application profile
      </p>
    </main>
  );
}
