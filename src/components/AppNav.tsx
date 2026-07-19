"use client";

/**
 * AppNav — the signed-in application chrome: brand, section tabs, account
 * actions. Full-width, sticky, frosted. Used on dashboard (and any future
 * signed-in pages) for a consistent product feel.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, LogOut, Settings2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs", label: "Browse contracts" },
] as const;

export function AppNav() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-500">
              <Briefcase size={15} className="text-black" />
            </div>
            <span className="text-sm font-bold text-slate-900">
              IR35<span className="text-slate-600">Careers</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 sm:flex">
            {TABS.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                    active
                      ? "bg-slate-900 text-slate-900 font-semibold"
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
          {user?.email && (
            <span className="hidden max-w-[180px] truncate text-xs text-slate-400 md:block">
              {user.email}
            </span>
          )}
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <Settings2 size={13} /> <span className="hidden sm:inline">Edit profile</span>
          </Link>
          <button
            onClick={() => signOut()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <LogOut size={13} /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>

      {/* Mobile tabs */}
      <div className="flex gap-1 border-t border-slate-200/70 px-4 py-2 sm:hidden">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex-1 rounded-full px-3 py-1.5 text-center text-xs transition-colors ${
                active ? "bg-white font-semibold text-black" : "text-slate-600"
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
