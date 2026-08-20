"use client";

/**
 * AppNav — signed-in application chrome: brand, section tabs, account actions.
 * Full-width, sticky, light. Green brand.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, UserCircle2, Loader2, Menu, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { checkBetaAccess } from "@/lib/access";
import { BetaDeniedModal } from "@/components/BetaDeniedModal";
import { Brand } from "@/components/ui/brand";

const TABS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs", label: "Contracts" },
  { href: "/applications", label: "Applications" },
  { href: "/inbox", label: "Inbox" },
  { href: "/automation", label: "Automation" },
  { href: "/alerts", label: "Alerts" },
  { href: "/network", label: "Network" },
  { href: "/research", label: "Research" },
] as const;

/**
 * Cached for the lifetime of the page load. Once access is confirmed we skip
 * the curtain on subsequent client-side navigations.
 */
let accessConfirmed = false;

export function AppNav() {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Curtain: protected content stays hidden until beta access is confirmed,
  // so a refused account never glimpses the dashboard before being redirected.
  const [checking, setChecking] = useState(!accessConfirmed);
  const [denied, setDenied] = useState<{ email?: string } | null>(null);
  const [accessError, setAccessError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Acts ONLY on an explicit denial. An "unknown" result (session still
  // hydrating after an OAuth redirect, or a transient network failure) is
  // retried once, then allowed through so nobody is locked out by a blip.
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
        await new Promise((r) => setTimeout(r, 1500));
        if (!active) return;
        result = await checkBetaAccess();
      }
      if (!active) return;

      if (result.state === "denied") {
        // Keep the session alive for now. Signing out here would trip each
        // page's own auth guard, which redirects and loses this message.
        setDenied({ email: result.email });
        return; // curtain stays up behind the modal
      }

      if (result.state === "unknown") {
        // Private/member routes fail closed. Keep the user's session and offer
        // a visible retry rather than revealing protected content or signing
        // them out during a temporary service problem.
        setAccessError(true);
        setChecking(false);
        return;
      }

      accessConfirmed = true;
      setChecking(false);
    };
    void run();
    return () => {
      active = false;
    };
  }, [user, signOut, router, retryNonce]);

  return (
    <>
      {denied && (
        <BetaDeniedModal
          email={denied.email}
          onJoin={async () => {
            await signOut();
            router.replace("/");
          }}
          onClose={async () => {
            await signOut();
            router.replace("/account");
          }}
        />
      )}
      {checking && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-50"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2 className="animate-spin text-slate-300" size={24} />
          <span className="sr-only">Checking access</span>
        </div>
      )}
      {accessError && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="access-check-title">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-floating">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><RefreshCw size={20} aria-hidden="true" /></span>
            <h2 id="access-check-title" className="mt-4 text-lg font-semibold text-slate-950">We couldn&apos;t confirm access</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Your session is still safe. Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => { setAccessError(false); setChecking(true); setRetryNonce((value) => value + 1); }}
              className="ir35-focus mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <RefreshCw size={15} aria-hidden="true" /> Try again
            </button>
          </div>
        </div>
      )}
    <nav className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      <div className="ir35-container flex h-16 items-center justify-between gap-4 sm:h-[72px]">
        <div className="flex min-w-0 items-center gap-6">
          <Brand href="/dashboard" />

          <div className="hidden items-center gap-1 xl:flex">
            {TABS.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`ir35-focus inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-medium transition-colors ${
                    active
                      ? "bg-brand-50 font-semibold text-brand-800"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
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
            href="/profile"
            aria-label="Contractor profile"
            className="ir35-focus inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
          >
            <UserCircle2 size={14} aria-hidden="true" /> <span className="hidden xl:inline">Profile</span>
          </Link>
          {user ? (
            <button
              onClick={async () => { await signOut(); router.replace("/"); }}
              className="ir35-focus inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
            >
              <LogOut size={14} /> <span className="hidden xl:inline">Sign out</span>
            </button>
          ) : (
            <span className="hidden rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 sm:inline">Local preview</span>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen((value) => !value)}
            className="ir35-focus inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 xl:hidden"
            aria-expanded={mobileOpen}
            aria-controls="member-mobile-menu"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          >
            {mobileOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div id="member-mobile-menu" className="animate-slide-down border-t border-slate-200 bg-white p-3 xl:hidden">
          <div className="grid gap-1">
            {TABS.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`ir35-focus flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold transition-colors ${
                    active ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
            <Link href="/profile" onClick={() => setMobileOpen(false)} className="ir35-focus flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">Contractor profile</Link>
            <Link href="/settings" onClick={() => setMobileOpen(false)} className="ir35-focus flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">Account settings</Link>
            <Link href="/billing" onClick={() => setMobileOpen(false)} className="ir35-focus flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">Plans and billing</Link>
          </div>
        </div>
      )}
    </nav>
    </>
  );
}
