import type { Metadata } from "next";
import { MessageSquareText, ShieldCheck } from "lucide-react";
import { ContactForm } from "@/components/ContactForm";
import { PublicFooter } from "@/components/PublicFooter";
import { PublicHeader } from "@/components/PublicHeader";

export const metadata: Metadata = { title: "Contact IR35Careers", description: "Contact IR35Careers about UK contract discovery, IR35 resources or your contractor workspace." };

export default function ContactPage() {
  return <div className="min-h-screen bg-slate-50"><PublicHeader /><main className="ir35-container py-12 sm:py-16"><div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]"><div><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-800"><MessageSquareText /></span><h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-950">Talk to IR35Careers</h1><p className="mt-4 text-base leading-7 text-slate-600">Ask about the product, suggest a contractor workflow or flag a listing that needs review.</p><div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="flex items-center gap-2 text-sm font-semibold text-emerald-950"><ShieldCheck size={17} /> Your details are not sold</p><p className="mt-1 text-sm leading-6 text-emerald-900">Production enquiries are stored privately for support follow-up. Local preview validates the form without transmitting it.</p></div></div><ContactForm /></div></main><PublicFooter /></div>;
}

