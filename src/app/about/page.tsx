import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, BriefcaseBusiness, FileCheck2, SearchCheck, ShieldCheck } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";
import { SITE_DESCRIPTION, SITE_ORIGIN } from "@/lib/seo";

export const metadata: Metadata = {
  title: "About IR35Careers",
  description:
    "Learn how IR35Careers helps UK contractors find Inside and Outside IR35 roles, prepare evidence-based applications and track employer responses.",
  alternates: { canonical: `${SITE_ORIGIN}/about` },
};

const PRINCIPLES = [
  {
    icon: SearchCheck,
    title: "Contract discovery with evidence",
    body: "Listings keep their original source, freshness and stated IR35 status so contractors can compare roles without hiding uncertainty.",
  },
  {
    icon: FileCheck2,
    title: "Truth-preserving preparation",
    body: "Resume analysis highlights relevant evidence and gaps. It does not invent skills, employers, qualifications or achievements.",
  },
  {
    icon: ShieldCheck,
    title: "Clear contractor control",
    body: "Application materials remain reviewable, important external steps stay visible and account data can be corrected or deleted.",
  },
] as const;

export default async function AboutPage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      "@id": `${SITE_ORIGIN}/about#webpage`,
      url: `${SITE_ORIGIN}/about`,
      name: "About IR35Careers",
      description: SITE_DESCRIPTION,
      isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
      about: { "@id": `${SITE_ORIGIN}/#organisation` },
      inLanguage: "en-GB",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "IR35Careers", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "About", item: `${SITE_ORIGIN}/about` },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <script
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <PublicHeader />
      <main>
        <section className="border-b border-slate-200 bg-white">
          <div className="ir35-container grid gap-10 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-24">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">About IR35Careers</p>
              <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-6xl">
                A UK contractor platform built around clearer evidence.
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
                IR35Careers brings contract discovery, role-specific Resume preparation and application tracking into one workspace for UK contractors.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link href="/jobs" className={buttonClassName({ variant: "primary", size: "lg" })}>
                  Browse contracts <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <Link href="/contact" className={buttonClassName({ variant: "secondary", size: "lg" })}>
                  Contact IR35Careers
                </Link>
              </div>
            </div>
            <div className="rounded-[2rem] border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-cyan-50 p-7 shadow-[0_24px_70px_rgba(15,118,110,0.12)] sm:p-9">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-700 text-white">
                <BriefcaseBusiness size={24} aria-hidden="true" />
              </span>
              <h2 className="mt-6 text-2xl font-bold tracking-tight text-slate-950">Focused on contract careers</h2>
              <p className="mt-3 text-base leading-7 text-slate-600">
                The product is designed for contract roles where IR35 status, rate, working pattern, evidence quality and employer follow-up all affect the decision to apply.
              </p>
              <dl className="mt-7 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-white bg-white/80 p-4"><dt className="text-slate-500">Audience</dt><dd className="mt-1 font-semibold text-slate-950">UK contractors</dd></div>
                <div className="rounded-2xl border border-white bg-white/80 p-4"><dt className="text-slate-500">Access</dt><dd className="mt-1 font-semibold text-slate-950">Public beta</dd></div>
                <div className="rounded-2xl border border-white bg-white/80 p-4"><dt className="text-slate-500">Role focus</dt><dd className="mt-1 font-semibold text-slate-950">UK contracts</dd></div>
                <div className="rounded-2xl border border-white bg-white/80 p-4"><dt className="text-slate-500">Support</dt><dd className="mt-1 font-semibold text-slate-950">Online contact</dd></div>
              </dl>
            </div>
          </div>
        </section>

        <section className="ir35-container py-14 sm:py-20" aria-labelledby="principles-heading">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">How the platform works</p>
            <h2 id="principles-heading" className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Practical help without hiding the important details.</h2>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {PRINCIPLES.map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-800"><Icon size={21} aria-hidden="true" /></span>
                <h3 className="mt-5 text-xl font-bold text-slate-950">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="ir35-container grid gap-8 py-14 sm:py-20 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-700">Independent checks still matter</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">IR35 evidence is context, not a legal guarantee.</h2>
            </div>
            <div className="space-y-4 text-base leading-7 text-slate-600">
              <p>IR35Careers reports what a listing states and keeps unclear roles visibly unconfirmed. The client determination, contract terms and real working practices still decide the final position.</p>
              <p>Guides and calculators are educational. Contractors should seek qualified legal or tax advice where an engagement needs a professional review.</p>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
