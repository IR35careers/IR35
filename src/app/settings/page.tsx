"use client";

/**
 * /settings — My Account. Account overview, profile strength, password change,
 * and security. Real data only. Green brand.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Loader2,
  User,
  FileText,
  KeyRound,
  ShieldCheck,
  Settings2,
  LogOut,
  CheckCircle2,
  Circle,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AppNav } from "@/components/AppNav";
import { getProfile, profileStrength, firstName, type Profile } from "@/lib/profile";

function StrengthRing({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <span className="relative inline-flex h-20 w-20 items-center justify-center">
      <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="#16a34a" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
      </svg>
      <span className="absolute text-lg font-bold tabular-nums text-slate-900">{pct}%</span>
    </span>
  );
}

export default function SettingsPage() {
  const { user, loading, updatePassword, signOut } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/account?next=/settings");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getProfile(user.id).then((p) => {
      setProfile(p);
      setReady(true);
    });
  }, [user]);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw1.length < 8) return setPwMsg({ ok: false, text: "Password must be at least 8 characters." });
    if (pw1 !== pw2) return setPwMsg({ ok: false, text: "Passwords don't match." });
    setPwBusy(true);
    const res = await updatePassword(pw1);
    setPwBusy(false);
    if (res.error) setPwMsg({ ok: false, text: res.error });
    else {
      setPwMsg({ ok: true, text: "Password updated." });
      setPw1("");
      setPw2("");
    }
  };

  if (loading || !user || !ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="animate-spin" size={22} />
      </main>
    );
  }

  const pct = profileStrength(profile);
  const name = firstName(profile, user.email ?? undefined);
  const provider = user.app_metadata?.provider ?? "email";
  const memberSince = new Date(user.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const checklist = [
    ["Skills added", (profile?.skills.length ?? 0) > 0],
    ["Experience added", profile?.years_experience != null],
    ["Preferences set", !!profile?.preferred_ir35],
    ["CV uploaded", !!profile?.cv_filename],
  ] as const;

  const sideLinks = [
    { label: "Account Overview", icon: User, href: "/settings", active: true },
    { label: "My Profile", icon: Settings2, href: "/onboarding" },
    { label: "CV & Documents", icon: FileText, href: "/onboarding" },
    { label: "Browse contracts", icon: ExternalLink, href: "/jobs" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav />
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[240px_1fr_320px]">
          {/* Settings nav */}
          <aside className="h-max rounded-2xl border border-slate-200 bg-white p-2">
            <nav className="space-y-1">
              {sideLinks.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                    l.active ? "bg-green-50 font-semibold text-green-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <l.icon size={15} /> {l.label}
                </Link>
              ))}
              <button onClick={async () => { await signOut(); router.replace("/"); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900">
                <LogOut size={15} /> Log out
              </button>
            </nav>
          </aside>

          {/* Main */}
          <div className="min-w-0 space-y-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">My Account</h1>
              <p className="mt-1 text-sm text-slate-500">Manage your profile, preferences and account settings.</p>
            </div>

            {/* Overview card */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Account overview</h2>
              <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {[
                  ["Name", profile?.full_name || "—"],
                  ["Email", user.email],
                  ["Sign-in method", provider === "google" ? "Google" : "Email & password"],
                  ["Member since", memberSince],
                  ["Current role", profile?.job_title || "—"],
                  ["Plan", "Free"],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                    <dt className="text-sm text-slate-500">{k}</dt>
                    <dd className="truncate text-sm font-medium text-slate-800">{v}</dd>
                  </div>
                ))}
              </dl>
              <Link href="/onboarding" className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-green-300 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 transition-colors hover:bg-green-100">
                Edit profile details
              </Link>
            </section>

            {/* Password */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <KeyRound size={15} /> Change password
              </h2>
              {provider === "google" && (
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  You sign in with Google. Setting a password here also lets you sign in with email.
                </p>
              )}
              <form onSubmit={changePassword} className="mt-4 grid max-w-md gap-3">
                <input
                  type="password"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  placeholder="New password (min 8 characters)"
                  autoComplete="new-password"
                  className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
                />
                <input
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                  className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50"
                />
                {pwMsg && (
                  <p className={`text-xs ${pwMsg.ok ? "text-green-700" : "text-red-600"}`}>{pwMsg.text}</p>
                )}
                <button
                  type="submit"
                  disabled={pwBusy}
                  className="inline-flex w-max items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
                >
                  {pwBusy ? <Loader2 size={15} className="animate-spin" /> : "Update password"}
                </button>
              </form>
            </section>

            {/* Security */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <ShieldCheck size={15} /> Account security
              </h2>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">Two-factor authentication</p>
                  <p className="text-xs text-slate-500">
                    {provider === "google"
                      ? "Managed by your Google account — enable 2FA there for full protection."
                      : "Sign in with Google to add two-factor protection to your account."}
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {provider === "google" ? "Via Google" : "Not set"}
                </span>
              </div>
            </section>
          </div>

          {/* Right rail */}
          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-green-600 text-xl font-bold text-white">
                {(name[0] ?? "U").toUpperCase()}
              </div>
              <p className="mt-3 font-semibold text-slate-900">{profile?.full_name || name}</p>
              <p className="text-xs text-slate-500">{profile?.job_title || "UK Contractor"}</p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-slate-800">Profile strength</h2>
              <div className="mt-4 flex items-center gap-4">
                <StrengthRing pct={pct} />
                <div>
                  <p className="text-sm font-semibold text-green-700">{pct >= 80 ? "Great!" : pct >= 50 ? "Getting there" : "Let's build this up"}</p>
                  <p className="text-xs text-slate-500">Add more details to improve your matches.</p>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {checklist.map(([label, done]) => (
                  <li key={label} className="flex items-center gap-2 text-sm">
                    {done ? <CheckCircle2 size={15} className="text-green-600" /> : <Circle size={15} className="text-slate-300" />}
                    <span className={done ? "text-slate-700" : "text-slate-400"}>{label}</span>
                  </li>
                ))}
              </ul>
              <Link href="/onboarding" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700">
                Improve profile
              </Link>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm font-semibold text-slate-800">Your plan</p>
              <p className="mt-0.5 text-xs text-slate-500">Free</p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                {["Browse all contracts", "Personalised matches", "Save & track applications"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-600" /> {f}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
