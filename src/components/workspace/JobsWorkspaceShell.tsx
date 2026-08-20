"use client";

import type { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";
import { useAuth } from "@/lib/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase-config";

export function JobsWorkspaceShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const memberView = !isSupabaseConfigured() || (!loading && Boolean(user));

  if (!memberView) return children;

  return (
    <div className="lg:pl-[248px]">
      <AppNav />
      {children}
    </div>
  );
}
