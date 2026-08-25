"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Menu, UserPlus, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Brand } from "@/components/ui/brand";
import { buttonClassName } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { ADMIN_PORTAL_ORIGIN, isAdministratorEmail } from "@/lib/portal-access";

const NAV_ITEMS = [
  { href: "/jobs", label: "Find contracts" },
  { href: "/resources", label: "IR35 guides" },
  { href: "/tools", label: "Tools" },
  { href: "/employers", label: "For employers" },
] as const;

export function PublicHeader({ hideForWorkspaceMembers = false }: { hideForWorkspaceMembers?: boolean }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const preview = !isSupabaseConfigured();
  const administrator = isAdministratorEmail(user?.email);
  const workspaceHref = administrator ? `${ADMIN_PORTAL_ORIGIN}/` : "/dashboard";

  // Keep the server-rendered menu control inert until its click handler is
  // attached, so a fast tap during hydration is never silently lost.
  useEffect(() => setHydrated(true), []);

  if (hideForWorkspaceMembers && ((user && !administrator) || preview)) return null;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
      <div className="ir35-container flex h-[68px] items-center justify-between gap-4 sm:h-[76px]">
        <div className="flex items-center gap-9">
          <Brand />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`ir35-focus inline-flex min-h-10 items-center rounded-xl px-3.5 text-sm font-semibold transition-colors ${
                    active
                      ? "bg-slate-100 text-slate-950"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {!loading && user && (
            <Link
              href={workspaceHref}
              className={buttonClassName({ variant: "primary", size: "sm", className: "hidden sm:inline-flex" })}
            >
              <LayoutDashboard size={15} aria-hidden="true" /> {administrator ? "Admin portal" : "Dashboard"}
            </Link>
          )}
          {!user && preview && (
            <Link
              href="/dashboard"
              className={buttonClassName({ variant: "primary", size: "sm", className: "hidden sm:inline-flex" })}
            >
              <LayoutDashboard size={15} aria-hidden="true" /> Preview workspace
            </Link>
          )}
          {!user && !preview && (
            <>
              <Link
                href="/account?next=%2Fdashboard"
                prefetch={false}
                className={buttonClassName({ variant: "quiet", size: "sm", className: "hidden sm:inline-flex" })}
              >
                Sign in
              </Link>
              <Link
                href="/account?mode=create&next=%2Fdashboard"
                prefetch={false}
                className={buttonClassName({ variant: "primary", size: "sm", className: "hidden sm:inline-flex" })}
              >
                <UserPlus size={15} aria-hidden="true" /> Create free account
              </Link>
            </>
          )}
          <button
            type="button"
            disabled={!hydrated}
            onClick={() => setOpen((value) => !value)}
            className="ir35-focus inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 disabled:cursor-wait disabled:opacity-60 md:hidden"
            aria-expanded={open}
            aria-controls="public-mobile-menu"
            aria-label={!hydrated ? "Navigation loading" : open ? "Close navigation" : "Open navigation"}
          >
            {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {open && (
        <div id="public-mobile-menu" className="animate-slide-down border-t border-slate-200 bg-white px-4 py-4 md:hidden">
          <nav className="mx-auto flex max-w-[1440px] flex-col gap-1" aria-label="Mobile navigation">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="ir35-focus flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                {item.label}
              </Link>
            ))}
            {user || preview ? (
              <Link
                href={workspaceHref}
                onClick={() => setOpen(false)}
                className={buttonClassName({ variant: "primary", className: "mt-2 w-full" })}
              >
                <LayoutDashboard size={16} aria-hidden="true" /> {administrator ? "Open admin portal" : user ? "Open dashboard" : "Open preview workspace"}
              </Link>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Link
                  href="/account?next=%2Fdashboard"
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className={buttonClassName({ variant: "secondary", className: "w-full" })}
                >
                  Sign in
                </Link>
                <Link
                  href="/account?mode=create&next=%2Fdashboard"
                  prefetch={false}
                  onClick={() => setOpen(false)}
                  className={buttonClassName({ variant: "primary", className: "w-full" })}
                >
                  Create account
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
