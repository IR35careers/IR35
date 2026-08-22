"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  Bot,
  BriefcaseBusiness,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Network,
  Search,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { useAuth } from "@/lib/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { useWorkspaceCloudSync, useWorkspaceState } from "@/lib/workspace/store";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "applications" | "unread";
};

const PRIMARY_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Browse jobs", icon: Search },
  { href: "/automation", label: "Auto Apply", icon: Bot },
  { href: "/applications", label: "Tracker", icon: BriefcaseBusiness, badge: "applications" },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: "unread" },
  { href: "/profile", label: "Profile", icon: UserRound },
] satisfies readonly NavItem[];

const SECONDARY_NAV = [
  { href: "/alerts", label: "Job alerts", icon: Bell },
  { href: "/network", label: "Network", icon: Network },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
] satisfies readonly NavItem[];

function activeRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(email?: string | null): string {
  return (email?.trim().slice(0, 1) || "U").toUpperCase();
}

export function AppNav() {
  const { user, signOut } = useAuth();
  const workspace = useWorkspaceState();
  const cloud = useWorkspaceCloudSync(isSupabaseConfigured() ? user?.id ?? null : null, user?.email ?? "");
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const counts = useMemo(() => cloud.error ? { applications: 0, unread: 0 } : ({
    applications: workspace.applications.filter((item) => !["rejected", "withdrawn", "failed", "skipped"].includes(item.status)).length,
    unread: workspace.messages.filter((item) => !item.read).length,
  }), [cloud.error, workspace.applications, workspace.messages]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const leaveWorkspace = async () => {
    await signOut();
    router.replace("/");
  };

  const navLink = (item: NavItem, mobile = false) => {
    const active = activeRoute(pathname, item.href);
    const badge = item.badge ? counts[item.badge] : 0;
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`ir35-focus group inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${
          active
            ? "bg-brand-50 text-brand-900"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
        } ${mobile ? "w-full justify-start" : "justify-center"}`}
      >
        <Icon size={16} className={active ? "text-brand-700" : "text-slate-400 group-hover:text-slate-600"} aria-hidden="true" />
        <span>{item.label}</span>
        {badge > 0 && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${active ? "bg-white text-brand-800" : "bg-slate-100 text-slate-600"}`}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      {cloud.loading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-50" aria-live="polite" aria-busy="true">
          <Loader2 className="animate-spin text-slate-300" size={24} />
          <span className="sr-only">Loading your workspace</span>
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-slate-200/90 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1600px] items-center gap-5 px-4 sm:px-6">
          <div className="shrink-0"><Brand href="/dashboard" /></div>

          <nav aria-label="Workspace navigation" className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 xl:flex">
            {PRIMARY_NAV.map((item) => navLink(item))}
          </nav>

          <div className="ml-auto hidden shrink-0 items-center gap-2 xl:flex">
            <Link href="/settings" aria-label="Settings" className={`ir35-focus inline-flex h-10 w-10 items-center justify-center rounded-xl ${activeRoute(pathname, "/settings") ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}>
              <Settings size={17} aria-hidden="true" />
            </Link>
            <details className="group relative">
              <summary className="ir35-focus flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 bg-white py-1.5 pl-1.5 pr-3 text-left hover:bg-slate-50">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-700 text-xs font-bold text-white">{initials(user?.email)}</span>
                <span className="max-w-36 truncate text-xs font-semibold text-slate-700">{user?.email ?? "Preview"}</span>
              </summary>
              <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
                <p className="truncate px-3 py-2 text-xs text-slate-500">{user?.email ?? "Local preview workspace"}</p>
                {SECONDARY_NAV.map((item) => navLink(item, true))}
                {user && <button type="button" onClick={() => void leaveWorkspace()} className="ir35-focus flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"><LogOut size={16} /> Sign out</button>}
              </div>
            </details>
          </div>

          <button type="button" onClick={() => setMobileOpen(true)} className="ir35-focus ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 xl:hidden" aria-expanded={mobileOpen} aria-controls="member-mobile-menu" aria-label="Open workspace navigation">
            <Menu size={19} aria-hidden="true" />
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />
          <aside id="member-mobile-menu" className="absolute inset-y-0 right-0 flex w-[min(92vw,360px)] flex-col bg-white shadow-2xl" aria-label="Workspace menu">
            <div className="flex h-[72px] items-center justify-between border-b border-slate-200 px-5">
              <Brand href="/dashboard" />
              <button type="button" onClick={() => setMobileOpen(false)} className="ir35-focus inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600" aria-label="Close navigation"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Main</p>
              <nav className="mt-2 space-y-1" aria-label="Main workspace links">{PRIMARY_NAV.map((item) => navLink(item, true))}</nav>
              <p className="mt-6 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">More</p>
              <nav className="mt-2 space-y-1" aria-label="More workspace links">{SECONDARY_NAV.map((item) => navLink(item, true))}{navLink({ href: "/settings", label: "Settings", icon: Settings }, true)}</nav>
            </div>
            <div className="border-t border-slate-200 p-4">
              <Link href="/profile" className="ir35-focus flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-sm font-bold text-white">{initials(user?.email)}</span>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{user?.email ?? "Preview workspace"}</span><span className="block text-xs text-slate-500">Profile and application details</span></span>
              </Link>
              {user && <button type="button" onClick={() => void leaveWorkspace()} className="ir35-focus mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600"><LogOut size={16} /> Sign out</button>}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
