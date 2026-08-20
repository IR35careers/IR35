"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  Inbox,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Network,
  RefreshCw,
  Search,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import { BetaDeniedModal } from "@/components/BetaDeniedModal";
import { Brand } from "@/components/ui/brand";
import { checkBetaAccess } from "@/lib/access";
import { useAuth } from "@/lib/auth-context";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { useWorkspaceCloudSync, useWorkspaceState } from "@/lib/workspace/store";

const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/jobs", label: "Find contracts", icon: Search },
      { href: "/applications", label: "Applications", icon: BriefcaseBusiness, badge: "applications" },
    ],
  },
  {
    label: "Search assistant",
    items: [
      { href: "/automation", label: "Automation", icon: Bot },
      { href: "/alerts", label: "Job alerts", icon: Bell },
    ],
  },
  {
    label: "Relationships",
    items: [
      { href: "/inbox", label: "Recruiter inbox", icon: Inbox, badge: "unread" },
      { href: "/network", label: "Network", icon: Network },
    ],
  },
  {
    label: "Insights",
    items: [{ href: "/analytics", label: "Analytics", icon: BarChart3 }],
  },
] as const;

let accessConfirmed = false;

function activeRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const { user, signOut } = useAuth();
  const workspace = useWorkspaceState();
  const cloud = useWorkspaceCloudSync(isSupabaseConfigured() ? user?.id ?? null : null, user?.email ?? "");
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(!accessConfirmed);
  const [denied, setDenied] = useState<{ email?: string } | null>(null);
  const [accessError, setAccessError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  const counts = useMemo(() => cloud.error ? { applications: 0, unread: 0 } : ({
    applications: workspace.applications.filter((item) => !["rejected", "withdrawn", "failed", "skipped"].includes(item.status)).length,
    unread: workspace.messages.filter((item) => !item.read).length,
  }), [cloud.error, workspace.applications, workspace.messages]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!user) {
      setChecking(false);
      return;
    }
    if (accessConfirmed) {
      setChecking(false);
      return;
    }
    let active = true;
    const run = async () => {
      let result = await checkBetaAccess();
      if (result.state === "unknown") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!active) return;
        result = await checkBetaAccess();
      }
      if (!active) return;
      if (result.state === "denied") {
        setDenied({ email: result.email });
        return;
      }
      if (result.state === "unknown") {
        setAccessError(true);
        setChecking(false);
        return;
      }
      accessConfirmed = true;
      setChecking(false);
    };
    void run();
    return () => { active = false; };
  }, [retryNonce, user]);

  const leaveWorkspace = async () => {
    await signOut();
    router.replace("/");
  };

  const sidebar = (mobile = false) => (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[72px] items-center justify-between border-b border-slate-200 px-5">
        <Brand href="/dashboard" />
        {mobile && (
          <button type="button" onClick={() => setMobileOpen(false)} className="ir35-focus inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600" aria-label="Close navigation">
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-5">
        <Link href="/jobs" className="ir35-focus mb-6 flex min-h-12 items-center justify-between rounded-2xl bg-slate-950 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-700">
          <span className="flex items-center gap-2.5"><Search size={17} aria-hidden="true" /> Find a contract</span>
          <ChevronRight size={15} aria-hidden="true" />
        </Link>

        <nav aria-label="Workspace navigation" className="space-y-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{group.label}</p>
              <div className="mt-2 space-y-1">
                {group.items.map((item) => {
                  const active = activeRoute(pathname, item.href);
                  const badge = "badge" in item ? counts[item.badge] : 0;
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`ir35-focus group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${active ? "bg-brand-50 text-brand-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>
                      <Icon size={17} className={active ? "text-brand-700" : "text-slate-400 group-hover:text-slate-600"} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {badge > 0 && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${active ? "bg-white text-brand-800" : "bg-slate-100 text-slate-600"}`}>{badge > 99 ? "99+" : badge}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="border-t border-slate-200 p-3">
        <Link href="/profile" className="ir35-focus flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><UserRound size={17} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate">{user?.email ?? "Preview workspace"}</span><span className="block text-[11px] font-normal text-slate-500">Profile and CV evidence</span></span>
        </Link>
        <div className="mt-1 grid grid-cols-2 gap-1">
          <Link href="/settings" className="ir35-focus flex min-h-10 items-center justify-center gap-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"><Settings size={14} aria-hidden="true" /> Settings</Link>
          {user ? <button type="button" onClick={() => void leaveWorkspace()} className="ir35-focus flex min-h-10 items-center justify-center gap-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"><LogOut size={14} aria-hidden="true" /> Sign out</button> : <span className="flex min-h-10 items-center justify-center text-[11px] font-semibold text-amber-700">Local preview</span>}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {denied && <BetaDeniedModal email={denied.email} onJoin={async () => { await leaveWorkspace(); }} onClose={async () => { await signOut(); router.replace("/account"); }} />}
      {(checking || cloud.loading) && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-50" aria-live="polite" aria-busy="true"><Loader2 className="animate-spin text-slate-300" size={24} /><span className="sr-only">Loading your workspace</span></div>}
      {accessError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="access-check-title">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-floating">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><RefreshCw size={20} aria-hidden="true" /></span>
            <h2 id="access-check-title" className="mt-4 text-lg font-semibold text-slate-950">We couldn&apos;t confirm access</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Your session is still safe. Check your connection and try again.</p>
            <button type="button" onClick={() => { setAccessError(false); setChecking(true); setRetryNonce((value) => value + 1); }} className="ir35-focus mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"><RefreshCw size={15} aria-hidden="true" /> Try again</button>
          </div>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-slate-200 lg:block" aria-label="Workspace sidebar">
        {sidebar()}
      </aside>

      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl lg:hidden">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <Brand href="/dashboard" />
          <button type="button" onClick={() => setMobileOpen(true)} className="ir35-focus inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700" aria-expanded={mobileOpen} aria-controls="member-mobile-menu" aria-label="Open workspace navigation"><Menu size={19} aria-hidden="true" /></button>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />
          <div id="member-mobile-menu" className="relative h-full w-[min(88vw,320px)] shadow-2xl">{sidebar(true)}</div>
        </div>
      )}
    </>
  );
}
