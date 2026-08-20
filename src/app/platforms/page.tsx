import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, ExternalLink, Globe2, Mail, Smartphone } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";

export const metadata: Metadata = { title: "Ways to use IR35Careers", description: "Search and manage UK contract opportunities from desktop, tablet or mobile." };
const platforms = [
  { icon: Globe2, title: "Web workspace", body: "Search, prepare, review and track from modern desktop, tablet and mobile browsers.", href: "/dashboard", action: "Open workspace" },
  { icon: Smartphone, title: "Mobile access", body: "Add IR35Careers to an iPhone, iPad or Android home screen for quick access to your contract search.", href: "/mobile", action: "View mobile guide" },
  { icon: BellRing, title: "Saved searches and alerts", body: "Save focused searches and return to matching opportunities without rebuilding your filters.", href: "/alerts", action: "Manage alerts" },
  { icon: ExternalLink, title: "Original job listings", body: "Review the source listing before applying, with the original employer or recruiter link kept visible.", href: "/jobs", action: "Browse contracts" },
  { icon: Mail, title: "Application messages", body: "Keep recruiter responses connected to the relevant opportunity inside your private workspace.", href: "/messaging", action: "How messaging works" },
];

export default function PlatformsPage() {
  return <div className="min-h-screen bg-slate-50"><PublicHeader /><main className="ir35-container py-12 sm:py-16"><div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Use IR35Careers your way</p><h1 className="mt-3 text-4xl font-bold tracking-[-0.04em] text-slate-950 sm:text-5xl">One contractor workspace, on every screen.</h1><p className="mt-5 text-base leading-7 text-slate-600">Search for UK contracts, review the details that matter and keep your application work together wherever you are.</p></div><div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{platforms.map((item)=><article key={item.title} className="flex min-h-64 flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-card"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><item.icon size={21} /></span><h2 className="mt-5 text-lg font-bold text-slate-950">{item.title}</h2><p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{item.body}</p><Link href={item.href} className="ir35-focus mt-5 inline-flex min-h-10 items-center font-bold text-brand-700">{item.action} →</Link></article>)}</div>
    <section id="install" className="mt-12 scroll-mt-28 rounded-3xl border border-slate-200 bg-slate-950 p-7 text-white sm:p-10"><p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">Install the app</p><h2 className="mt-3 text-2xl font-bold">Keep IR35Careers on your home screen</h2><div className="mt-6 grid gap-6 md:grid-cols-2"><div><h3 className="font-bold">iPhone and iPad</h3><ol className="mt-3 ml-5 list-decimal space-y-2 text-sm leading-6 text-slate-300"><li>Open IR35Careers in Safari.</li><li>Choose Share, then Add to Home Screen.</li><li>Confirm the IR35Careers name and mark.</li></ol></div><div><h3 className="font-bold">Android and desktop Chrome</h3><ol className="mt-3 ml-5 list-decimal space-y-2 text-sm leading-6 text-slate-300"><li>Open the browser menu.</li><li>Choose Install app or Add to Home screen.</li><li>Open it from the new app icon.</li></ol></div></div></section>
  </main><PublicFooter /></div>;
}
