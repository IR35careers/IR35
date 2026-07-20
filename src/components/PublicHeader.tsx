"use client";

/**
 * PublicHeader — minimal top bar for public pages (tools). Works whether or
 * not the visitor is signed in.
 */

import Link from "next/link";
import { Briefcase } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export function PublicHeader() {
  const { user } = useAuth();
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-green-600">
            <Briefcase size={15} className="text-white" />
          </div>
          <span className="text-sm font-bold text-slate-900">
            IR35<span className="text-slate-500">Careers</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/jobs" className="rounded-full px-3.5 py-1.5 text-sm text-slate-600 transition-colors hover:text-slate-900">
            Browse contracts
          </Link>
          <Link
            href={user ? "/dashboard" : "/account"}
            className="rounded-full bg-green-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-700"
          >
            {user ? "Dashboard" : "Sign up"}
          </Link>
        </div>
      </div>
    </header>
  );
}
