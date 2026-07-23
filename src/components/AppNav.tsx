"use client";

/**
 * AppNav — signed-in application chrome: brand, section tabs, account actions.
 * Full-width, sticky, light. Green brand.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Briefcase, LogOut, UserCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useEffect } from "react";
import { hasBetaAccess } from "@/lib/access";

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs", label: "Browse contracts" },
  { href: "/saved", label: "Saved" },
  { href: "/alerts", label: "Alerts" },
  { href: "/tools", label: "Tools" },
] as const;

export function AppNav() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Private beta: only allowlisted accounts may use the signed-in app.
  useEffect(() => {
    if (!user) return;
    let active = true;
    hasBetaAccess().then(async (ok) => {
      if (!active || ok) return;
      await signOut();
      router.replace("/account?denied=1");
    });
    return () => {
      active = false;
    };
  }, [user, signOut, router]);

  return (
    <nav className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-green-600">
              <Briefcase size={15} className="text-white" />
            </div>
            <span className="text-sm font-bold text-slate-900">
              IR35<span className="text-slate-500">Careers</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 sm:flex">
            {TABS.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50 ${
                    active
                      ? "bg-green-600 font-semibold text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
          >
            <UserCircle2 size={14} /> <span className="hidden sm:inline">My Account</span>
          </Link>
          <button
            onClick={async () => { await signOut(); router.replace("/"); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
          >
            <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-t border-slate-200 px-4 py-2 sm:hidden">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 rounded-full px-3 py-1.5 text-center text-xs transition-colors ${
                active ? "bg-green-600 font-semibold text-white" : "text-slate-600"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
