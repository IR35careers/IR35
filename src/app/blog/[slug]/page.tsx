import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, ExternalLink } from "lucide-react";
import { HomeScrollProgress } from "@/components/HomeMotion";
import { Reveal } from "@/components/HomeReveal";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { BLOG_POSTS, formatBlogDate, getBlogPost } from "@/lib/blog-posts";
import { SITE_ORIGIN } from "@/lib/seo";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      url: `${SITE_ORIGIN}/blog/${post.slug}`,
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
    },
  };
}

export default async function BlogArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();
  const related = BLOG_POSTS.filter((candidate) => candidate.slug !== post.slug).slice(0, 2);
  const schema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: { "@type": "Organization", name: "IR35Careers" },
    publisher: { "@type": "Organization", name: "IR35Careers", url: SITE_ORIGIN },
    mainEntityOfPage: `${SITE_ORIGIN}/blog/${post.slug}`,
  };

  return (
    <div className="min-h-screen bg-[#f7faf9] text-slate-950">
      <HomeScrollProgress />
      <PublicHeader />
      <main>
        <article>
          <header className="relative overflow-hidden border-b border-emerald-100 bg-[#071b1b] text-white">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_12%,rgba(52,211,153,0.19),transparent_28%)]" />
            <div className="ir35-container relative py-12 sm:py-20">
              <Link href="/blog" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-200 hover:text-white"><ArrowLeft size={15} />IR35 guides</Link>
              <Reveal>
                <div className="mt-10 flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-300">
                  <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-emerald-200">{post.category}</span>
                  <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} />Updated {formatBlogDate(post.updatedAt)}</span>
                  <span className="inline-flex items-center gap-1.5"><Clock3 size={14} />{post.readingMinutes} min read</span>
                </div>
                <h1 className="mt-6 max-w-5xl text-4xl font-bold tracking-[-0.045em] sm:text-6xl">{post.title}</h1>
                <p className="mt-6 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">{post.description}</p>
              </Reveal>
            </div>
          </header>

          <div className="ir35-container grid gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_19rem] lg:py-16">
            <div className="min-w-0">
              <Reveal className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-800">What to take away</p>
                <ul className="mt-5 space-y-4">
                  {post.takeaways.map((takeaway) => (
                    <li key={takeaway} className="flex gap-3 text-sm leading-7 text-slate-700"><CheckCircle2 size={19} className="mt-1 shrink-0 text-emerald-700" />{takeaway}</li>
                  ))}
                </ul>
              </Reveal>

              <div className="mt-10 space-y-10">
                {post.sections.map((section, index) => (
                  <Reveal key={section.heading} delay={Math.min(index * 0.03, 0.12)}>
                    <section className="border-b border-slate-200 pb-10 last:border-0">
                      <h2 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{section.heading}</h2>
                      <div className="mt-5 space-y-5">
                        {section.paragraphs.map((paragraph) => <p key={paragraph} className="text-base leading-8 text-slate-700">{paragraph}</p>)}
                      </div>
                      {section.bullets?.length ? (
                        <ul className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
                          {section.bullets.map((bullet) => <li key={bullet} className="flex gap-3 text-sm leading-7 text-slate-700"><span className="mt-3 size-1.5 shrink-0 rounded-full bg-emerald-600" />{bullet}</li>)}
                        </ul>
                      ) : null}
                    </section>
                  </Reveal>
                ))}
              </div>
            </div>

            <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Official sources</p>
                <div className="mt-4 space-y-3">
                  {post.sources.map((source) => (
                    <a key={source.href} href={source.href} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold leading-6 text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50">
                      {source.label}<ExternalLink size={14} className="mt-1 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-950 p-6 text-white">
                <p className="text-lg font-semibold">Find a contract with clearer evidence.</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">Compare status signals, rate and working pattern before preparing your application.</p>
                <Link href="/jobs" className="mt-5 inline-flex items-center gap-2 font-semibold text-emerald-300">Browse contracts <ArrowRight size={15} /></Link>
              </div>
            </aside>
          </div>

          <section className="border-y border-slate-200 bg-white">
            <div className="ir35-container py-12 sm:py-16">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Continue reading</h2>
              <div className="mt-7 grid gap-5 md:grid-cols-2">
                {related.map((item) => (
                  <Link key={item.slug} href={`/blog/${item.slug}`} className="group rounded-2xl border border-slate-200 p-6 transition hover:border-emerald-200 hover:bg-emerald-50/40">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">{item.category}</p>
                    <h3 className="mt-3 text-xl font-bold tracking-tight">{item.title}</h3>
                    <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">Read guide <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></span>
                  </Link>
                ))}
              </div>
              <p className="mt-8 text-xs leading-6 text-slate-500">Educational information only. This guide is not individual tax or legal advice. Status depends on the full facts and working practices of each engagement.</p>
            </div>
          </section>
        </article>
      </main>
      <PublicFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    </div>
  );
}
