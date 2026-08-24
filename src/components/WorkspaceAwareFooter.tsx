"use client";

import { PublicFooter } from "@/components/PublicFooter";
import { useAuth } from "@/lib/auth-context";
import { isAdministratorEmail } from "@/lib/portal-access";
import { isSupabaseConfigured } from "@/lib/supabase-config";

/** Public legal navigation for visitors, hidden inside the contractor workspace. */
export function WorkspaceAwareFooter() {
  const { user, loading } = useAuth();
  const preview = !isSupabaseConfigured();

  if (loading || preview || (user && !isAdministratorEmail(user.email))) return null;
  return <PublicFooter />;
}
