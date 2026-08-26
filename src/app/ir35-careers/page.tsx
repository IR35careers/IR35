import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  CloudCog,
  ExternalLink,
  Gauge,
  Search,
  ShieldCheck,
} from "lucide-react";
import { HomeScrollProgress, Reveal } from "@/components/HomeMotion";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { buttonClassName } from "@/components/ui/button";
import { SITE_ORIGIN } from "@/lib/seo";

const PAGE_URL = `${SITE_ORIGIN}/ir35-careers`;

export const metadata: Metadata = {
  title: "IR35 Careers: UK Contract Jobs, Rates and Guidance",
  description:
    "Explore IR35 careers in the UK. Find contract jobs, compare Inside and Outside IR35 roles, understand day rates and use free contractor tools.",
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "IR35 Careers: UK Contract Jobs, Rates and Guidance",
    description:
      "Find UK contract roles and understand how Inside and Outside IR35 can affect your next career move.",
    url: PAGE_URL,
    type: "website",
  },
};

const CAREER_PATHS = [
  {
    icon: CloudCog,
    title: "Technology and cloud",
    body: "Software engineering, DevOps, cloud, cyber security, data and platform contract roles.",
  },
  {
    icon: BriefcaseBusiness,
    title: "Delivery and change",
    body: "Project, programme, product, business analysis and transformation contract roles.",
  },
  {
    icon: Gauge,
    title: "Specialist consulting",
    body: "Finance, procurement, compliance, operations and other independent specialist engagements.",
  },
] as const;

const FAQS = [
  {
    question: "What does IR35 careers mean?",
    answer:
      "IR35 careers describes UK contract work where the off-payroll working rules may apply. It is not a separate profession. The rules can affect how an engagement is taxed and how the contractor works with the client.",
  },
  {
    question: "Is an Outside IR35 role always better?",
    answer:
      "No. Status is one part of the decision. Contractors should also compare the day rate, working practices, contract length, location, expenses, risk and their own circumstances.",
  },
  {
    question: "Can a job advert decide the final IR35 status?",
    answer:
      "An advert can state the intended status, but the written contract and actual working practices still matter. Where the advert is unclear, IR35Careers keeps that uncertainty visible instead of guessing.",
  },
  {
    question: "Where can I find Inside and Outside IR35 jobs?",
    answer:
      "IR35Careers indexes UK contract opportunities and lets contractors search by stated IR35 status, rate, location, skill and working pattern.",
  },
] as const;

export default async function Ir35CareersPage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${PAGE_URL}#webpage`,
      url: PAGE_URL,
      name: "IR35 Careers: UK Contract Jobs, Rates and Guidance",
      description:
        "A practical guide to IR35 careers, UK contract jobs, Inside and Outside IR35 status and contractor tools.",
      isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
      about: [
        { "@type": "Thing", name: "IR35" },
        { "@type": "Thing", name: "UK contract careers" },
      ],
      inLanguage: "en-GB",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "IR35Careers", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "IR35 careers", item: PAGE_URL },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    },
  ];

  return (
    <div className="min-h-screen bg-[#f7faf8] text-slate-950">
      <script
        nonce={nonce}
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <HomeScrollProgress />
      <PublicHeader />

      <main>
        <section className="ir35-home-hero relative overflow-hidden border-b border-emerald-100/80">
          <div aria-hidden="true" className="ir35-home-grid absolute inset-0 opacity-40" />
          <div aria-hidden="true" className="absolute -right-32 -top-28 h-[32rem] w-[32rem] rounded-full border-[76px] border-emerald-100/50" />
          <div className="ir35-container relative grid gap-10 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.75fr] lg:items-center lg:py-24">
            <Reveal>
              <div className="max-w-3xl">
                <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/90 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800 shadow-sm">
                  <Search size={15} aria-hidden="true" /> UK contractor careers
                </p>
                <h1 className="mt-6 text-4xl font-semibold leading-[1.02] tracking-[-0.055em] sm:text-5xl lg:text-6xl">
                  IR35 careers for UK contractors.
                </h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                  Find UK contract jobs, compare stated Inside and Outside IR35 status, understand day rates and make a better informed career move.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link href="/jobs" className={buttonClassName({ variant: "primary", size: "lg" })}>
                    Search contract jobs <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                  <Link href="/resources" className={buttonClassName({ variant: "secondary", size: "lg" })}>
                    Understand IR35
                  </Link>
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.12}>
              <aside className="rounded-[30px] border border-emerald-200/80 bg-white/92 p-6 shadow-[0_28px_80px_rgba(15,23,42,0.1)] backdrop-blur sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Start with the evidence</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight">Compare the whole opportunity.</h2>
                <ul className="mt-6 space-y-4">
                  {[
                    "Stated IR35 status and evidence",
                    "Day rate, location and working pattern",
                    "Contract length, expectations and source",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                      <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="/jobs?ir35=outside" className="ir35-focus mt-7 inline-flex items-center gap-2 rounded text-sm font-semibold text-emerald-800">
                  Browse Outside IR35 contracts <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </aside>
            </Reveal>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white py-12 sm:py-18">
          <div className="ir35-container grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
            <Reveal>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">What the phrase means</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">IR35 careers are contract careers.</h2>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="space-y-4 text-base leading-8 text-slate-600">
                <p>
                  IR35 careers are UK contract roles where the off-payroll working rules may affect the engagement. IR35 is not a profession or job category. It is a tax status question that can apply across technology, engineering, finance, delivery, change and other specialist careers.
                </p>
                <p>
                  A role may be advertised as Inside IR35, Outside IR35 or without enough evidence to confirm either. IR35Careers preserves the status stated by the source and keeps unclear listings visibly unconfirmed.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="ir35-home-surface py-12 sm:py-20">
          <div className="ir35-container">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Popular contract paths</p>
              <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Build a contract career around your evidence.</h2>
            </Reveal>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {CAREER_PATHS.map((path, index) => (
                <Reveal key={path.title} delay={index * 0.06}>
                  <article className="ir35-card h-full p-6 sm:p-7">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                      <path.icon size={21} aria-hidden="true" />
                    </div>
                    <h3 className="mt-5 text-xl font-semibold tracking-tight">{path.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{path.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white py-12 sm:py-20">
          <div className="ir35-container">
            <Reveal>
              <div className="grid overflow-hidden rounded-[30px] border border-slate-200 lg:grid-cols-2">
                <article className="bg-rose-50/60 p-7 sm:p-9">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">Inside IR35</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">Taxed broadly like employment.</h2>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    PAYE income tax and National Insurance are usually deducted, often through an umbrella company. Compare the advertised rate with likely deductions and employment costs.
                  </p>
                  <Link href="/jobs?ir35=inside" className="ir35-focus mt-6 inline-flex items-center gap-2 rounded text-sm font-semibold text-rose-800">
                    Find Inside IR35 roles <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </article>
                <article className="border-t border-slate-200 bg-emerald-50/70 p-7 sm:p-9 lg:border-l lg:border-t-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Outside IR35</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-tight">An independent business engagement.</h2>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    The engagement should reflect genuine self-employment in both the contract and actual working practices. Contractors commonly deliver through their own limited company.
                  </p>
                  <Link href="/jobs?ir35=outside" className="ir35-focus mt-6 inline-flex items-center gap-2 rounded text-sm font-semibold text-emerald-800">
                    Find Outside IR35 roles <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </article>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="ir35-home-surface py-12 sm:py-20">
          <div className="ir35-container grid gap-8 lg:grid-cols-[1fr_0.9fr]">
            <div>
              <Reveal>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Common questions</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">IR35 careers, clearly explained.</h2>
              </Reveal>
              <div className="mt-7 space-y-3">
                {FAQS.map((item, index) => (
                  <Reveal key={item.question} delay={index * 0.04}>
                    <details className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <summary className="ir35-focus cursor-pointer list-none rounded text-base font-semibold text-slate-950 marker:hidden">
                        {item.question}
                      </summary>
                      <p className="mt-3 text-sm leading-7 text-slate-600">{item.answer}</p>
                    </details>
                  </Reveal>
                ))}
              </div>
            </div>

            <Reveal delay={0.12}>
              <aside className="rounded-[28px] border border-slate-800 bg-slate-950 p-7 text-white shadow-xl sm:p-9 lg:sticky lg:top-28">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300">
                  <ShieldCheck size={22} aria-hidden="true" />
                </div>
                <h2 className="mt-6 text-2xl font-semibold tracking-tight">Check the role before you decide.</h2>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                  Use the free take-home calculator and indicative status checker to prepare better questions about your next engagement.
                </p>
                <div className="mt-7 flex flex-col gap-3">
                  <Link href="/tools/take-home" className={buttonClassName({ variant: "accent" })}>Take-home calculator</Link>
                  <Link href="/tools/ir35-status" className={buttonClassName({ variant: "secondary", className: "border-slate-600 bg-transparent text-white hover:bg-white/10" })}>IR35 status checker</Link>
                </div>
                <p className="mt-7 border-t border-slate-800 pt-6 text-xs leading-6 text-slate-400">
                  Educational information only, not tax or legal advice. Read the official HMRC guidance on{" "}
                  <a className="ir35-focus inline-flex items-center gap-1 rounded font-semibold text-emerald-300 underline" href="https://www.gov.uk/guidance/understanding-off-payroll-working-ir35" target="_blank" rel="noopener noreferrer">
                    off-payroll working <ExternalLink size={12} aria-hidden="true" />
                  </a>.
                </p>
              </aside>
            </Reveal>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
