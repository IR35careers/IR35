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
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  Circle,
  Download,
  Trash2,
  Brain,
  SlidersHorizontal,
  Mail,
  LockKeyhole,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AppNav } from "@/components/AppNav";
import { getProfile, profileStrength, firstName, type Profile } from "@/lib/profile";
import { useContractorPortalBoundary } from "@/components/useContractorPortalBoundary";
import { useWorkspaceState } from "@/lib/workspace/store";
import { AccountSidebar } from "@/components/account/AccountSidebar";

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
  const workspace = useWorkspaceState();
  const router = useRouter();
  const administratorRedirect = useContractorPortalBoundary(user?.email, loading);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dataBusy, setDataBusy] = useState<"export" | "delete" | null>(null);
  const [dataMsg, setDataMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState("");

  useEffect(() => {
    if (!administratorRedirect && !loading && !user) router.replace("/account?next=/settings");
  }, [administratorRedirect, user, loading, router]);

  useEffect(() => {
    if (!user || administratorRedirect) return;
    getProfile(user.id).then((p) => {
      setProfile(p);
      setReady(true);
    });
  }, [administratorRedirect, user]);

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

  const accountRequest = async (method: "GET" | "DELETE") => {
    const { getSupabase } = await import("@/lib/supabase");
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Your session has expired. Sign in again and retry.");
    return fetch("/api/account", {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === "DELETE" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "DELETE" ? JSON.stringify({ email: deleteEmail, confirmation: "DELETE" }) : undefined,
    });
  };

  const downloadData = async () => {
    setDataBusy("export");
    setDataMsg(null);
    try {
      const response = await accountRequest("GET");
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ir35careers-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setDataMsg({ ok: true, text: "Your account export has downloaded." });
    } catch (error) {
      setDataMsg({ ok: false, text: error instanceof Error ? error.message : "Export failed." });
    } finally {
      setDataBusy(null);
    }
  };

  const deleteAccount = async () => {
    if (deleteEmail.trim().toLowerCase() !== (user?.email ?? "").trim().toLowerCase()) return;
    setDataBusy("delete");
    setDataMsg(null);
    try {
      const response = await accountRequest("DELETE");
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Deletion failed.");
      await signOut();
      router.replace("/?account=deleted");
    } catch (error) {
      setDataMsg({ ok: false, text: error instanceof Error ? error.message : "Deletion failed." });
      setDataBusy(null);
    }
  };

  if (administratorRedirect || loading || !user || !ready) {
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
    ["Resume uploaded", !!profile?.cv_filename],
  ] as const;
  const applicationProfile = workspace.profile;
  const applyPreferences = applicationProfile.applicationPreferences;
  const accountEmail = user.email ?? applicationProfile.email;
  const forwardingEmail = workspace.inbox.forwardingEmail || applicationProfile.forwardingEmail || accountEmail;
  const workAuthorisation = applicationProfile.rightToWork === "yes"
    ? "Authorised to work in the UK"
    : applicationProfile.rightToWork === "needs_sponsorship"
      ? "Requires sponsorship"
      : applicationProfile.rightToWork === "no"
        ? "Not authorised to work in the UK"
        : "Not provided";
  const rememberedFacts = [
    ["Target role", applicationProfile.targetRole],
    ["Location", applicationProfile.location],
    ["Work authorisation", workAuthorisation],
    ["Availability", applicationProfile.availability],
    ["Skills", applicationProfile.skills?.slice(0, 8).join(", ")],
    ["IR35 preference", profile?.preferred_ir35 === "either" ? "Inside or Outside IR35" : profile?.preferred_ir35],
    ["Workplace", profile?.preferred_remote],
    ["Minimum day rate", profile?.target_rate_min ? `£${profile.target_rate_min}/day` : ""],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav />
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[240px_1fr_320px]">
          <AccountSidebar active="overview" />

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
                  ["Name", profile?.full_name || "N/A"],
                  ["Email", user.email],
                  ["Sign-in method", provider === "google" ? "Google" : "Email & password"],
                  ["Member since", memberSince],
                  ["Current role", profile?.job_title || "N/A"],
                  ["Plan", "Free"],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                    <dt className="text-sm text-slate-500">{k}</dt>
                    <dd className="truncate text-sm font-medium text-slate-800">{v}</dd>
                  </div>
                ))}
              </dl>
              <Link href="/profile#application-readiness" className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-green-300 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700 transition-colors hover:bg-green-100">
                Edit profile details
              </Link>
              <Link href="/dashboard?tour=1" className="ml-2 mt-4 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300">
                Replay product tour
              </Link>
            </section>

            <section id="memory" className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500"><Brain size={15} /> What IR35Careers remembers</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">These are the reusable facts and preferences saved in your private contractor profile. You can edit or remove them at any time.</p>
                </div>
                <Link href="/profile" className="ir35-focus inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-brand-300">Review profile</Link>
              </div>
              {rememberedFacts.length ? <dl className="mt-5 grid gap-3 sm:grid-cols-2">{rememberedFacts.map(([label, value]) => <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-sm font-semibold capitalize text-slate-900">{value}</dd></div>)}</dl> : <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-6 text-center"><p className="text-sm font-semibold text-slate-800">Nothing saved yet</p><p className="mt-1 text-xs leading-5 text-slate-500">Add your role, skills and preferences so applications can reuse accurate information.</p></div>}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500"><SlidersHorizontal size={15} /> Application defaults</h2><p className="mt-2 text-sm leading-6 text-slate-600">Control how Resume improvements and cover letters are prepared. Every employer submission still requires your final approval.</p></div><Link href="/profile#apply-settings" className="ir35-focus inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800">Edit apply settings</Link></div>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Resume optimisation</dt><dd className="mt-1 text-sm font-semibold capitalize text-slate-900">{applyPreferences?.resumeOptimisation ?? "honest"}</dd></div><div className="rounded-xl bg-slate-50 p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Safe edits</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{applyPreferences?.autoApproveSafeEdits ? "Apply automatically, then review" : "Review each suggestion"}</dd></div><div className="rounded-xl bg-slate-50 p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Final review</dt><dd className="mt-1 text-sm font-semibold text-slate-900">Always required</dd></div><div className="rounded-xl bg-slate-50 p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Cover letter</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{applyPreferences?.generateCoverLetter === false ? "Use saved letter only" : "Prepare when required"}</dd></div></dl>
            </section>

            <section id="email-integration" className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500"><Mail size={15} /> Application email</h2><p className="mt-2 text-sm leading-6 text-slate-600">Employer messages use your private IR35Careers application address and are linked to the correct application.</p></div><Link href="/inbox" className="ir35-focus inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-brand-300">Open inbox</Link></div>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-brand-100 bg-brand-50 p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-brand-700">IR35Careers email</dt><dd className="mt-1 break-all font-mono text-sm font-semibold text-brand-950">{workspace.inbox.alias || "Not created"}</dd></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Your account email</dt><dd className="mt-1 break-all text-sm font-semibold text-slate-900">{forwardingEmail}</dd><p className="mt-1 text-xs text-slate-500">Recruiter updates are forwarded here when forwarding is enabled.</p></div></dl>
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><LockKeyhole className="mt-0.5 shrink-0 text-slate-500" size={17} /><p className="text-xs leading-5 text-slate-600">IR35Careers does not store employer portal passwords. It derives a separate secure password for each employer and completes approved applications with the server runner. No browser extension is required. An employer CAPTCHA, identity check or declaration remains under your control.</p></div>
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
                      ? "Managed by your Google account. Enable 2FA there for full protection."
                      : "Sign in with Google to add two-factor protection to your account."}
                  </p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {provider === "google" ? "Via Google" : "Not set"}
                </span>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                <Download size={15} /> Your data and account
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Download a portable JSON copy of your profile, saved roles, alerts, Resume versions, application workspace, inbox and automation records.</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={() => void downloadData()} disabled={dataBusy !== null} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-brand-300 disabled:opacity-60">
                  {dataBusy === "export" ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />} Download account data
                </button>
                <button type="button" onClick={() => setDeleteOpen((value) => !value)} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-800 hover:bg-rose-100">
                  <Trash2 size={15} /> Delete account
                </button>
              </div>
              {deleteOpen && (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-sm font-bold text-rose-950">This permanently deletes the account and private Resume files.</p>
                  <p className="mt-1 text-xs leading-5 text-rose-800">Download your data first. To confirm, enter the signed-in email address <span className="font-semibold">{user.email}</span>.</p>
                  <label className="mt-3 block text-xs font-semibold text-rose-900">Account email
                    <input value={deleteEmail} onChange={(event) => setDeleteEmail(event.target.value)} type="email" autoComplete="email" className="ir35-focus mt-1.5 min-h-11 w-full rounded-xl border border-rose-300 bg-white px-3 text-sm text-slate-950" />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void deleteAccount()} disabled={dataBusy !== null || deleteEmail.trim().toLowerCase() !== (user.email ?? "").trim().toLowerCase()} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50">
                      {dataBusy === "delete" ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />} Permanently delete account
                    </button>
                    <button type="button" onClick={() => { setDeleteOpen(false); setDeleteEmail(""); }} className="ir35-focus min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-700">Cancel</button>
                  </div>
                </div>
              )}
              {dataMsg && <p role={dataMsg.ok ? "status" : "alert"} className={`mt-4 rounded-xl border px-4 py-3 text-sm ${dataMsg.ok ? "border-brand-200 bg-brand-50 text-brand-900" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{dataMsg.text}</p>}
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
              <Link href="/profile#application-readiness" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700">
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
