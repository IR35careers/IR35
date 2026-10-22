import Link from "next/link";
import { PublicHeader } from "@/components/PublicHeader";
import { PublicFooter } from "@/components/PublicFooter";
import { allSeoSlugs, getSeoPage } from "@/lib/seo-pages";
import { getPublicJobInventory, matchesSeoFilters } from "@/lib/public-job-inventory";
import { withPublicPageMetadata } from "@/lib/seo";

export const metadata = withPublicPageMetadata("/contracts", {
  title: "Browse UK Contract Jobs by Skill and Location",
  description: "Explore current UK contract roles by skill, city, remote working and IR35 status. Compare live opportunities and rates before you apply.",
});

export default async function ContractsIndex() {
  const inventory = await getPublicJobInventory();
  const categories = allSeoSlugs().map(getSeoPage).filter(page => page !== null)
    .map(page => ({ ...page, count: inventory.filter(job => matchesSeoFilters(job, page.filters)).length }))
    .filter(page => page.count > 0);
  return <><PublicHeader /><main className="mx-auto max-w-6xl px-4 py-12">
    <h1 className="text-3xl font-bold tracking-tight text-slate-950">Browse UK contracts</h1>
    <p className="mt-3 text-slate-600">Explore current opportunities by skill, location and IR35 status.</p>
    {categories.length ? <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{categories.map(page =>
      <li key={page.slug}><Link className="ir35-focus flex h-full justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-5 text-emerald-950" href={`/contracts/${page.slug}`}>
        <span>{page.h1}</span><span className="tabular-nums">{page.count}</span>
      </Link></li>)}</ul> : <p className="mt-8 text-slate-600">No live categories are available right now. <Link className="underline" href="/jobs">Try contract search</Link>.</p>}
  </main><PublicFooter /></>;
}
