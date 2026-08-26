import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, CheckCircle2, Clock3 } from "lucide-react";
import { HomeScrollProgress } from "@/components/HomeMotion";
import { Reveal } from "@/components/HomeReveal";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { BLOG_POSTS, formatBlogDate } from "@/lib/blog-posts";

export const metadata: Metadata = {
  title: "IR35 contractor guides and insights",
  description: "Practical, evidence-led IR35 guides for UK contractors comparing status, working practices, rates and contract opportunities.",
};

const accentClasses = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  sky: "border-sky-200 bg-sky-50 text-sky-800",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
  rose: "border-rose-200 bg-rose-50 text-rose-800",
};

export default function BlogPage() {
  const [featured, ...articles] = BLOG_POSTS;

  return (
    <div className="min-h-screen bg-[#f7faf9] text-slate-950">
      <HomeScrollProgress />
      <PublicHeader />
      <main>
        <section className="relative overflow-hidden border-b border-emerald-100 bg-[#071b1b] text-white">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_84%_10%,rgba(52,211,153,0.2),transparent_28%),radial-gradient(circle_at_12%_90%,rgba(45,212,191,0.12),transparent_30%)]" />
          <div className="ir35-container relative grid gap-10 py-14 sm:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-end lg:py-24">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">IR35 field notes</p>
              <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-[-0.045em] sm:text-6xl">Clearer decisions for your next contract.</h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">Practical guidance on status, working practices and contract value, written for UK contractors who need useful answers before they apply.</p>
            </Reveal>
            <Reveal delay={0.1} className="grid gap-3 sm:grid-cols-3">
              {[
                ["Current", "Reviewed against current HMRC guidance"],
                ["Practical", "Built around real contract decisions"],
                ["Evidence-led", "Clear sources and honest uncertainty"],
              ].map(([title, copy]) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
                  <CheckCircle2 size={20} className="text-emerald-300" aria-hidden="true" />
                  <p className="mt-4 font-semibold text-white">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{copy}</p>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="ir35-container py-12 sm:py-16">
          <Reveal>
            <Link href={`/blog/${featured.slug}`} className="group grid overflow-hidden rounded-[2rem] border border-emerald-200 bg-white shadow-[0_22px_70px_rgba(15,23,42,0.08)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_90px_rgba(15,23,42,0.12)] lg:grid-cols-[0.88fr_1.12fr]">
              <div className="relative min-h-72 overflow-hidden bg-[linear-gradient(145deg,#063d35,#0b6f5c_60%,#31c48d)] p-8 text-white sm:p-10">
                <div className="absolute -right-16 -top-16 size-64 rounded-full border-[40px] border-white/10" />
                <div className="absolute -bottom-20 -left-16 size-56 rounded-full border-[32px] border-emerald-200/15" />
                <BookOpen size={28} className="relative text-emerald-200" aria-hidden="true" />
                <p className="relative mt-16 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">Featured guide</p>
                <p className="relative mt-3 max-w-sm text-3xl font-bold tracking-tight sm:text-4xl">The checks that matter before you accept.</p>
              </div>
              <div className="flex flex-col justify-center p-8 sm:p-10 lg:p-12">
                <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-500">
                  <span className={`rounded-full border px-3 py-1 ${accentClasses[featured.accent]}`}>{featured.category}</span>
                  <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} />{formatBlogDate(featured.updatedAt)}</span>
                  <span className="inline-flex items-center gap-1.5"><Clock3 size={14} />{featured.readingMinutes} min read</span>
                </div>
                <h2 className="mt-6 text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-4xl">{featured.title}</h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">{featured.description}</p>
                <span className="mt-8 inline-flex items-center gap-2 font-semibold text-emerald-800">Read the guide <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" /></span>
              </div>
            </Link>
          </Reveal>
        </section>

        <section className="ir35-container pb-16 sm:pb-24">
          <Reveal className="flex items-end justify-between gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Contractor library</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Read what helps you decide.</h2>
            </div>
            <p className="hidden max-w-md text-right text-sm leading-6 text-slate-500 md:block">Every article links to its official sources and separates facts from practical interpretation.</p>
          </Reveal>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {articles.map((post, index) => (
              <Reveal key={post.slug} delay={index * 0.06}>
                <Link href={`/blog/${post.slug}`} className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_12px_40px_rgba(15,23,42,0.05)] transition duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-[0_20px_55px_rgba(15,23,42,0.09)] sm:p-8">
                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                    <span className={`rounded-full border px-3 py-1 ${accentClasses[post.accent]}`}>{post.category}</span>
                    <span>{post.readingMinutes} min read</span>
                  </div>
                  <h3 className="mt-6 text-2xl font-bold tracking-tight text-slate-950">{post.title}</h3>
                  <p className="mt-3 flex-1 text-sm leading-7 text-slate-600">{post.description}</p>
                  <div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-5">
                    <span className="text-xs font-medium text-slate-500">Updated {formatBlogDate(post.updatedAt)}</span>
                    <span className="inline-flex items-center gap-2 font-semibold text-emerald-800">Read <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-10 rounded-2xl border border-slate-200 bg-slate-100/80 px-6 py-5 text-sm leading-6 text-slate-600">
            IR35Careers provides educational information, not individual tax or legal advice. Contract status depends on the facts and working practices of each engagement.
          </Reveal>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
