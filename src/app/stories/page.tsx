import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircleHeart, ShieldCheck } from "lucide-react";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contractor stories", description: "Consented, reviewed stories from UK contractors using IR35Careers." };

interface Story { id: string; display_name: string; role_label: string; quote: string }

async function getStories(): Promise<Story[]> {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!configured) return [];
  const { data } = await supabase.from("testimonials").select("id, display_name, role_label, quote").eq("status", "approved").not("approved_at", "is", null).order("approved_at", { ascending: false });
  return (data ?? []) as Story[];
}

export default async function StoriesPage() {
  const stories = await getStories();
  return <div className="min-h-screen bg-slate-50"><PublicHeader /><main className="ir35-container py-12 sm:py-16"><div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">Contractor stories</p><h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">Real experiences, published with consent</h1><p className="mt-4 text-base leading-7 text-slate-600">IR35Careers does not invent testimonials or publish private feedback. Every story requires recorded consent and review.</p></div>{stories.length ? <div className="mt-10 grid gap-5 lg:grid-cols-3">{stories.map((story) => <figure key={story.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card"><MessageCircleHeart className="text-brand-700" /><blockquote className="mt-5 text-base leading-7 text-slate-800">“{story.quote}”</blockquote><figcaption className="mt-5 border-t border-slate-100 pt-4"><p className="font-semibold text-slate-950">{story.display_name}</p><p className="text-sm text-slate-500">{story.role_label}</p></figcaption></figure>)}</div> : <div className="mt-10 max-w-2xl rounded-3xl border border-dashed border-slate-300 bg-white p-8"><ShieldCheck className="text-brand-700" /><h2 className="mt-4 text-lg font-semibold text-slate-950">No approved stories yet</h2><p className="mt-2 text-sm leading-6 text-slate-600">This is an intentional empty state, not a placeholder quote. Approved stories will appear automatically after consent is recorded.</p><Link href="/contact" className="ir35-focus mt-5 inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">Share product feedback</Link></div>}</main><PublicFooter /></div>;
}
