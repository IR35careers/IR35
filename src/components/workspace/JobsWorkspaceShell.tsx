"use client";

import type { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";
import { useAuth } from "@/lib/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { isAdministratorEmail } from "@/lib/portal-access";

export function JobsWorkspaceShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const memberView = !isSupabaseConfigured() || (!loading && Boolean(user) && !isAdministratorEmail(user?.email));

  if (!memberView) return children;

  return (
    <div className="ir35-workspace-canvas min-h-screen">
      <AppNav />
      {children}
    </div>
  );
}
