"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Brain,
  CreditCard,
  FileText,
  Globe2,
  LogOut,
  Mail,
  SlidersHorizontal,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export type AccountSection =
  | "overview"
  | "apply-settings"
  | "memory"
  | "profile"
  | "connections"
  | "billing"
  | "referrals"
  | "email";

const ACCOUNT_LINKS: Array<{
  section: AccountSection;
  label: string;
  href: string;
  icon: typeof User;
}> = [
  { section: "overview", label: "Account Overview", href: "/settings", icon: User },
  { section: "apply-settings", label: "Apply settings", href: "/profile#apply-settings", icon: SlidersHorizontal },
  { section: "memory", label: "What IR35Careers remembers", href: "/settings#memory", icon: Brain },
  { section: "profile", label: "Profile and documents", href: "/profile", icon: FileText },
  { section: "connections", label: "Connections", href: "/settings/connections", icon: Globe2 },
  { section: "billing", label: "Plans and billing", href: "/billing", icon: CreditCard },
  { section: "referrals", label: "Referrals", href: "/network", icon: Users },
  { section: "email", label: "Email integration", href: "/inbox", icon: Mail },
];

export function AccountSidebar({ active }: { active: AccountSection }) {
  const { signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);
    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, [pathname]);

  const selectedSection: AccountSection = pathname === "/profile" && hash === "#apply-settings"
    ? "apply-settings"
    : pathname === "/settings" && hash === "#memory"
      ? "memory"
      : active;

  return (
    <aside className="ir35-account-sidebar h-max rounded-2xl border border-slate-200/90 bg-white p-2 shadow-[0_18px_50px_-44px_rgba(15,23,42,0.3)] lg:sticky lg:top-24">
      <p className="hidden px-3 pb-2 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 lg:block">Account</p>
      <nav aria-label="Account" className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
        {ACCOUNT_LINKS.map((item) => {
          const Icon = item.icon;
          const selected = item.section === selectedSection;
          return (
            <Link
              key={item.section}
              href={item.href}
              aria-current={selected ? "page" : undefined}
              className={`ir35-focus flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                selected
                  ? "bg-brand-50 font-semibold text-brand-900"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }`}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={async () => {
            await signOut();
            router.replace("/");
          }}
          className="ir35-focus flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
        >
          <LogOut size={16} aria-hidden="true" />
          <span>Log out</span>
        </button>
      </nav>
    </aside>
  );
}
