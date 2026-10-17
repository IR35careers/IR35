"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { authenticatedDestination } from "@/lib/portal-access";

/** Keep authenticated members out of the public marketing journey. */
export function AuthenticatedHomeRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (configured && !loading && user) {
      const destination = authenticatedDestination(user.email);
      if (destination.startsWith("https://")) window.location.replace(destination);
      else router.replace(destination);
    }
  }, [configured, loading, router, user]);

  if (!configured || (!loading && !user)) return null;

  return (
    <div className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center bg-slate-50" role="status" aria-live="polite">
      <Loader2 className="animate-spin text-brand-600" size={24} aria-hidden="true" />
      <span className="sr-only">Opening your workspace</span>
    </div>
  );
}
