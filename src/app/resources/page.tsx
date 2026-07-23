import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Calculator, ShieldQuestion, ExternalLink } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";

export const metadata: Metadata = {
  title: "IR35 Resources for UK Contractors | IR35Careers",
  description:
    "Plain-English guides to IR35 for UK contractors: what inside vs outside means, how status is decided, and free tools to check status and estimate take-home.",
  alternates: { canonical: "https://ir35careers.com/resources" },
};

const GUIDES = [
  {
    title: "What is IR35?",
    body:
      "IR35 (the off-payroll working rules) decides whether a contractor is genuinely self-employed or, for tax purposes, effectively an employee of the client. If a role is 'inside IR35', income tax and National Insurance are deducted like employment. If 'outside IR35', you can work through your own limited company more tax-efficiently. Since April 2021, for medium and large private-sector clients, it's the client, not you, who determines the status.",
  },
  {
    title: "Inside vs Outside IR35: what changes",
    body:
      "Inside IR35 means you're taxed broadly like an employee: PAYE income tax and NI are deducted (often via an umbrella company), and your take-home is lower. Outside IR35 means HMRC accepts you're in business on your own account, so you can pay yourself a mix of salary and dividends through a limited company, keeping more of your rate. The difference in take-home can be significant, which is why the status shown on a contract matters so much.",
  },
  {
    title: "How is IR35 status decided?",
    body:
      "It hinges on the real working arrangement, not just the contract wording. The main factors are: control (does the client dictate how, when and where you work?), substitution (can you send a qualified replacement?), and mutuality of obligation (is the client obliged to offer work and you to accept it?). Supporting factors include financial risk, providing your own equipment, and whether you're 'part and parcel' of the organisation. HMRC's CEST tool gives an official indicative view.",
  },
  {
    title: "Umbrella vs limited company",
    body:
      "For inside-IR35 roles, contractors typically work through an umbrella company, which employs you and runs PAYE. That is simple, but employer NI and a margin come out of the assignment rate. For outside-IR35 roles, a limited company is usually more tax-efficient via low salary plus dividends, though it comes with accounting responsibilities. Which is better depends on the role's IR35 status and your day rate.",
  },
];

export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />
      <main className="mx-auto max-w-[1500px] px-4 py-10 sm:px-6">
        <div className="flex items-center gap-2">
          <BookOpen className="text-green-600" size={22} />
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">IR35 resources</h1>
        </div>
        <p className="mt-2 max-w-2xl text-slate-600">
          Plain-English guides to IR35 for UK contractors, plus free tools to check a contract&apos;s
          status and estimate your take-home.
        </p>

        {/* Tool shortcuts */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link href="/tools/ir35-status" className="group flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-green-300">
            <ShieldQuestion className="text-green-600" size={22} />
            <div>
              <h2 className="font-semibold text-slate-900">IR35 Status Checker</h2>
              <p className="mt-1 text-sm text-slate-600">Answer a few questions for an indicative inside/outside view.</p>
              <span className="mt-2 inline-block text-sm font-semibold text-green-700 group-hover:underline">Check status →</span>
            </div>
          </Link>
          <Link href="/tools/take-home" className="group flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-green-300">
            <Calculator className="text-green-600" size={22} />
            <div>
              <h2 className="font-semibold text-slate-900">Take-Home Calculator</h2>
              <p className="mt-1 text-sm text-slate-600">Estimate your annual take-home inside vs outside IR35 (2026/27).</p>
              <span className="mt-2 inline-block text-sm font-semibold text-green-700 group-hover:underline">Calculate →</span>
            </div>
          </Link>
        </div>

        {/* Guides */}
        <div className="mt-8 space-y-4">
          {GUIDES.map((g) => (
            <section key={g.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900">{g.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-700">{g.body}</p>
            </section>
          ))}
        </div>

        <p className="mt-8 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
          Educational information only, not tax or legal advice. IR35 status depends on the specific
          facts of each engagement. For an official view use HMRC&apos;s{" "}
          <a className="inline-flex items-center gap-0.5 text-green-700 underline" href="https://www.gov.uk/guidance/check-employment-status-for-tax" target="_blank" rel="noopener noreferrer">
            CEST tool <ExternalLink size={11} />
          </a>{" "}
          and consider professional advice.
        </p>
      </main>
    </div>
  );
}
