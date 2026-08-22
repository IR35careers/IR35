"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Camera, CheckCircle2, ChevronLeft, ImagePlus, Loader2, MessageCircle, Paperclip, Send, X } from "lucide-react";
import type { FeedbackCategory, FeedbackRecord } from "@/lib/admin-feedback";
import { useAuth } from "@/lib/auth-context";
import { fetchWithFreshSession } from "@/lib/authenticated-fetch";
import { isAdministratorEmail } from "@/lib/portal-access";
import { isSupabaseConfigured } from "@/lib/supabase-config";

const WORKSPACE_PATHS = ["/dashboard", "/jobs", "/applications", "/automation", "/alerts", "/inbox", "/network", "/analytics", "/profile", "/settings", "/saved"];
const CATEGORY_OPTIONS: Array<{ value: FeedbackCategory; label: string }> = [
  { value: "application", label: "Job application" },
  { value: "job_listing", label: "Job listing" },
  { value: "account", label: "Account or profile" },
  { value: "billing", label: "Billing" },
  { value: "accessibility", label: "Accessibility" },
  { value: "general", label: "Something else" },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function statusLabel(status: FeedbackRecord["status"]): string {
  if (status === "in_progress") return "In progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

async function captureCurrentPage(): Promise<File> {
  const { default: html2canvas } = await import("html2canvas");
  await document.fonts?.ready;

  const canvas = await html2canvas(document.documentElement, {
    allowTaint: false,
    backgroundColor: "#f8fafc",
    height: window.innerHeight,
    ignoreElements: (element) => element.hasAttribute("data-feedback-capture-ui"),
    logging: false,
    scale: Math.min(window.devicePixelRatio || 1, 1.5),
    scrollX: -window.scrollX,
    scrollY: -window.scrollY,
    useCORS: true,
    width: window.innerWidth,
    windowHeight: window.innerHeight,
    windowWidth: window.innerWidth,
    x: window.scrollX,
    y: window.scrollY,
  });

  const createBlob = (type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await createBlob("image/webp", 0.9);
  let type = "image/webp";
  let extension = "webp";

  if (!blob || blob.size > 5 * 1024 * 1024) {
    blob = await createBlob("image/jpeg", 0.88);
    type = "image/jpeg";
    extension = "jpg";
  }
  if (!blob) throw new Error("The page screenshot could not be created. Upload an image instead.");

  return new File([blob], `ir35careers-page-${Date.now()}.${extension}`, { type });
}

export function FeedbackBubble() {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"new" | "history" | "ticket">("new");
  const [tickets, setTickets] = useState<FeedbackRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<FeedbackCategory>("general");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [reply, setReply] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const visible = !loading && (Boolean(user) || !isSupabaseConfigured()) && !isAdministratorEmail(user?.email) && WORKSPACE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? null;
  const unread = useMemo(() => tickets.reduce((count, ticket) => count + (ticket.messages ?? []).filter((item) => item.author_type === "admin" && !item.read_by_user_at).length, 0), [tickets]);
  const preview = useMemo(() => attachment ? URL.createObjectURL(attachment) : null, [attachment]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const loadTickets = async (focusId?: string | null) => {
    if (!user) return;
    setLoadingTickets(true);
    setError(null);
    try {
      const response = await fetchWithFreshSession("/api/feedback");
      const json = await response.json() as { tickets?: FeedbackRecord[]; error?: string };
      if (!response.ok) throw new Error(json.error ?? "Your feedback history could not be loaded.");
      setTickets(json.tickets ?? []);
      if (focusId && (json.tickets ?? []).some((ticket) => ticket.id === focusId)) {
        setSelectedId(focusId);
        setView("ticket");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your feedback history could not be loaded.");
    } finally {
      setLoadingTickets(false);
    }
  };

  const openTicket = async (ticketId: string) => {
    setSelectedId(ticketId);
    setView("ticket");
    setSuccess(null);
    const now = new Date().toISOString();
    setTickets((current) => current.map((ticket) => ticket.id === ticketId ? {
      ...ticket,
      messages: (ticket.messages ?? []).map((item) => item.author_type === "admin" ? { ...item, read_by_user_at: item.read_by_user_at || now } : item),
    } : ticket));
    const form = new FormData();
    form.set("mode", "read");
    form.set("feedbackId", ticketId);
    await fetchWithFreshSession("/api/feedback", { method: "POST", body: form }).catch(() => undefined);
  };

  useEffect(() => {
    const ticketId = new URLSearchParams(window.location.search).get("feedback");
    if (!visible || !ticketId) return;
    setOpen(true);
    void loadTickets(ticketId);
    // The ticket query is intentionally handled only when navigation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, visible]);

  useEffect(() => {
    if (!visible) return;
    void loadTickets();
    const timer = window.setInterval(() => void loadTickets(), 60_000);
    return () => window.clearInterval(timer);
    // Poll only while a signed-in contractor workspace is visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, user?.id]);

  const chooseFile = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setError("Upload a PNG, JPG or WebP image.");
    if (file.size > 5 * 1024 * 1024) return setError("The image must be 5 MB or smaller.");
    setAttachment(file);
  };

  const takeScreenshot = async () => {
    setCapturing(true);
    setError(null);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      setAttachment(await captureCurrentPage());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The screenshot could not be captured.");
    } finally {
      setCapturing(false);
    }
  };

  const submitTicket = async () => {
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();
    if (trimmedSubject.length < 5 || trimmedMessage.length < 20) {
      setSubmitAttempted(true);
      setError("Complete the highlighted fields so we can investigate the issue properly.");
      const target = trimmedSubject.length < 5 ? subjectRef.current : messageRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => target?.focus(), 250);
      return;
    }

    setSubmitting(true);
    setSubmitAttempted(false);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      form.set("subject", subject);
      form.set("message", message);
      form.set("category", category);
      form.set("pageUrl", window.location.href);
      form.set("browserContext", `${navigator.userAgent} | ${window.innerWidth}x${window.innerHeight}`);
      if (attachment) form.set("attachment", attachment);
      const response = await fetchWithFreshSession("/api/feedback", { method: "POST", body: form });
      const json = await response.json() as { ticket?: FeedbackRecord; message?: string; error?: string };
      if (!response.ok || !json.ticket) throw new Error(json.error ?? "Your feedback could not be sent.");
      setTickets((current) => [json.ticket as FeedbackRecord, ...current]);
      setSelectedId(json.ticket.id);
      setSubject("");
      setMessage("");
      setCategory("general");
      setAttachment(null);
      setSubmitAttempted(false);
      setSuccess(json.message ?? "Thank you for your feedback. We will review it and keep you updated.");
      setView("ticket");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your feedback could not be sent.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("mode", "reply");
      form.set("feedbackId", selected.id);
      form.set("message", reply);
      const response = await fetchWithFreshSession("/api/feedback", { method: "POST", body: form });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Your reply could not be sent.");
      setReply("");
      await loadTickets(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your reply could not be sent.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <>
      <button type="button" data-feedback-capture-ui="true" onClick={() => { setOpen(true); setSuccess(null); if (!tickets.length) void loadTickets(); }} className="ir35-focus fixed bottom-5 right-4 z-[60] inline-flex min-h-12 items-center gap-2 rounded-full bg-brand-700 px-4 text-sm font-bold text-white shadow-[0_14px_35px_rgba(3,105,79,0.3)] transition hover:bg-brand-800 sm:bottom-6 sm:right-6" aria-label="Send feedback">
        <MessageCircle size={19} aria-hidden="true" />
        <span className="hidden sm:inline">Feedback</span>
        {unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-brand-800">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && <div data-feedback-capture-ui="true" className="fixed inset-0 z-[70] flex items-end justify-end bg-slate-950/35 p-0 backdrop-blur-[2px] sm:p-5" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className="flex max-h-[min(760px,94vh)] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl sm:w-[430px] sm:rounded-3xl">
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-950 px-5 py-5 text-white">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">IR35Careers support</p>
              <h2 id="feedback-title" className="mt-1 text-xl font-semibold">How can we help?</h2>
              <p className="mt-1 text-xs leading-5 text-slate-300">Report an issue and follow every update here.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="ir35-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 text-slate-200 hover:bg-white/10" aria-label="Close feedback"><X size={18} /></button>
          </header>

          {view !== "ticket" && <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 p-1.5">
            <button type="button" onClick={() => setView("new")} className={`min-h-10 rounded-xl text-xs font-semibold ${view === "new" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>Report an issue</button>
            <button type="button" onClick={() => { setView("history"); void loadTickets(); }} className={`min-h-10 rounded-xl text-xs font-semibold ${view === "history" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>My feedback {tickets.length ? `(${tickets.length})` : ""}</button>
          </div>}

          <div className="overflow-y-auto p-5">
            {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-800" role="alert">{error}</div>}
            {view === "new" && <div className="space-y-4">
              <label className="block text-xs font-semibold text-slate-700">What is this about?<select value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100">{CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="block text-xs font-semibold text-slate-700">Short title<input ref={subjectRef} value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={140} aria-invalid={submitAttempted && subject.trim().length < 5} aria-describedby={submitAttempted && subject.trim().length < 5 ? "feedback-subject-error" : undefined} placeholder="Example: CV preview is not loading" className={`mt-2 min-h-11 w-full rounded-xl border px-3 text-sm outline-none placeholder:text-slate-400 focus:ring-4 ${submitAttempted && subject.trim().length < 5 ? "border-rose-400 bg-rose-50/40 focus:border-rose-500 focus:ring-rose-100" : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"}`} />{submitAttempted && subject.trim().length < 5 && <span id="feedback-subject-error" className="mt-1.5 block text-[11px] font-medium text-rose-700">Add a clear title using at least 5 characters.</span>}</label>
              <label className="block text-xs font-semibold text-slate-700">What happened?<textarea ref={messageRef} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} rows={6} aria-invalid={submitAttempted && message.trim().length < 20} aria-describedby={submitAttempted && message.trim().length < 20 ? "feedback-message-error" : undefined} placeholder="Tell us what you were doing, what went wrong and what you expected to happen." className={`mt-2 w-full resize-y rounded-xl border px-3 py-3 text-sm leading-6 outline-none placeholder:text-slate-400 focus:ring-4 ${submitAttempted && message.trim().length < 20 ? "border-rose-400 bg-rose-50/40 focus:border-rose-500 focus:ring-rose-100" : "border-slate-300 focus:border-brand-500 focus:ring-brand-100"}`} />{submitAttempted && message.trim().length < 20 && <span id="feedback-message-error" className="mt-1.5 block text-[11px] font-medium text-rose-700">Describe what happened using at least 20 characters.</span>}</label>
              <div>
                <p className="text-xs font-semibold text-slate-700">Add an image</p>
                <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => inputRef.current?.click()} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"><ImagePlus size={15} /> Upload image</button><button type="button" onClick={() => void takeScreenshot()} disabled={capturing} className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{capturing ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />} {capturing ? "Capturing page" : "Capture page"}</button></div>
                <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} />
                {preview && <div className="relative mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50"><Image src={preview} alt="Feedback attachment preview" width={720} height={440} unoptimized className="max-h-44 w-full object-contain" /><button type="button" onClick={() => setAttachment(null)} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950/80 text-white" aria-label="Remove image"><X size={14} /></button><p className="truncate px-3 py-2 text-[11px] text-slate-500"><Paperclip size={11} className="mr-1 inline" />{attachment?.name}</p></div>}
                <p className="mt-2 text-[11px] leading-4 text-slate-500">Capture saves the visible IR35Careers page only. This feedback panel is excluded. Uploaded images can be PNG, JPG or WebP up to 5 MB.</p>
              </div>
              <button type="button" onClick={() => void submitTicket()} disabled={submitting} className="ir35-focus inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:cursor-wait disabled:opacity-60">{submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {submitting ? "Sending securely" : "Send feedback"}</button>
            </div>}

            {view === "history" && <div>{loadingTickets ? <div className="flex min-h-44 items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={20} /></div> : tickets.length ? <div className="space-y-3">{tickets.map((ticket) => { const ticketUnread = (ticket.messages ?? []).some((item) => item.author_type === "admin" && !item.read_by_user_at); return <button key={ticket.id} type="button" onClick={() => void openTicket(ticket.id)} className="block w-full rounded-2xl border border-slate-200 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/30"><div className="flex items-start justify-between gap-3"><p className="font-semibold text-slate-950">{ticket.subject || "Customer feedback"}{ticketUnread && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-blue-600" aria-label="Unread support reply" />}</p><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${ticket.status === "resolved" ? "bg-emerald-50 text-emerald-700" : ticket.status === "in_progress" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{statusLabel(ticket.status)}</span></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{ticket.message}</p><p className="mt-3 text-[11px] text-slate-400">{formatDate(ticket.created_at)}</p></button>; })}</div> : <div className="py-12 text-center"><MessageCircle className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-semibold text-slate-800">No feedback yet</p><p className="mt-1 text-xs text-slate-500">Your reports and support updates will appear here.</p></div>}</div>}

            {view === "ticket" && selected && <div>
              <button type="button" onClick={() => { setView("history"); setSuccess(null); }} className="ir35-focus inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-slate-600"><ChevronLeft size={15} /> All feedback</button>
              {success && <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"><CheckCircle2 className="mb-2" size={20} />{success}</div>}
              <div className="mt-3 flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-slate-950">{selected.subject || "Customer feedback"}</h3><p className="mt-1 text-[11px] text-slate-400">Reference {selected.id.slice(0, 8).toUpperCase()}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${selected.status === "resolved" ? "bg-emerald-50 text-emerald-700" : selected.status === "in_progress" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{statusLabel(selected.status)}</span></div>
              <div className="mt-5 space-y-3">
                <article className="mr-5 rounded-2xl rounded-tl-md bg-slate-100 p-4"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{selected.message}</p>{selected.attachment_url && <a href={selected.attachment_url} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-xl border border-slate-200 bg-white"><Image src={selected.attachment_url} alt="Feedback attachment" width={720} height={440} unoptimized className="max-h-48 w-full object-contain" /></a>}<p className="mt-2 text-[10px] text-slate-400">You, {formatDate(selected.created_at)}</p></article>
                {(selected.messages ?? []).map((item) => <article key={item.id} className={`rounded-2xl p-4 ${item.author_type === "admin" ? "ml-5 rounded-tr-md bg-brand-50" : item.author_type === "system" ? "border border-slate-200 bg-white" : "mr-5 rounded-tl-md bg-slate-100"}`}><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.message}</p>{item.attachment_url && <a href={item.attachment_url} target="_blank" rel="noreferrer" className="mt-3 block text-xs font-semibold text-brand-700">View attached image</a>}<p className="mt-2 text-[10px] text-slate-400">{item.author_type === "admin" ? "IR35Careers support" : item.author_type === "system" ? "Status update" : "You"}, {formatDate(item.created_at)}</p></article>)}
              </div>
              {selected.status !== "spam" && <div className="mt-5 border-t border-slate-200 pt-4"><label className="block text-xs font-semibold text-slate-700">Add a reply<textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={3} maxLength={5000} placeholder="Add more information or ask for an update." className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-3 py-3 text-sm leading-6 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100" /></label><button type="button" onClick={() => void sendReply()} disabled={submitting || !reply.trim()} className="ir35-focus mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50">{submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send reply</button></div>}
            </div>}
          </div>
        </section>
      </div>}
    </>
  );
}
