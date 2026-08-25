"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  AtSign,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Copy,
  Inbox,
  Loader2,
  MailCheck,
  Reply,
  Search,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { getSupabase } from "@/lib/supabase";
import { fetchWithFreshSession } from "@/lib/authenticated-fetch";
import {
  inboxViewCategory,
  inboxViewCategoryLabel,
  isUnsolicitedJobMarketingMessage,
  type InboxViewCategory,
} from "@/lib/workspace/mail";
import { updateWorkspace, useWorkspaceState } from "@/lib/workspace/store";
import type { InboxMessage } from "@/lib/workspace/types";

type FilterId = "all" | InboxViewCategory;
type EmailState = "loading" | "preview" | "connected" | "gated" | "error";

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "verification", label: "Verification" },
  { id: "interview", label: "Interview" },
  { id: "assessment", label: "Assessment" },
  { id: "reminder", label: "Reminder" },
  { id: "offer", label: "Offer" },
  { id: "applied", label: "Confirmations" },
  { id: "retry", label: "Try again" },
  { id: "rejection", label: "Rejection" },
  { id: "needs_you", label: "Action needed" },
];

function categoryStyle(category: InboxViewCategory): string {
  if (category === "offer" || category === "interview")
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (category === "rejection")
    return "border-rose-200 bg-rose-50 text-rose-700";
  if (
    category === "needs_you" ||
    category === "retry" ||
    category === "assessment" ||
    category === "reminder"
  )
    return "border-amber-200 bg-amber-50 text-amber-800";
  if (category === "verification" || category === "applied")
    return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function CategoryPill({ message }: { message: InboxMessage }) {
  const category = inboxViewCategory(message);
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${categoryStyle(category)}`}
    >
      {inboxViewCategoryLabel(category)}
    </span>
  );
}

function canReplyToMessage(message: InboxMessage): boolean {
  return Boolean(
    message.applicationId &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(message.from.trim()),
  );
}

export function RecruiterInbox() {
  const workspace = useWorkspaceState();
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [emailState, setEmailState] = useState<EmailState>(
    isSupabaseConfigured() ? "loading" : "preview",
  );
  const [activating, setActivating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    workspace.messages[0]?.id ?? null,
  );
  const [mobileReading, setMobileReading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyMessage, setReplyMessage] = useState<InboxMessage | null>(null);
  const [replyRequestKey, setReplyRequestKey] = useState("");
  const [composeMessage, setComposeMessage] = useState("");
  const [sending, setSending] = useState(false);
  const hasAlias =
    workspace.inbox.alias !== "Not created" &&
    (workspace.inbox.providerState === "connected" || emailState === "preview");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workspace.messages.filter((message) => {
      if (
        isUnsolicitedJobMarketingMessage(
          message.subject,
          message.body,
          message.from,
        )
      )
        return false;
      const category = inboxViewCategory(message);
      const categoryMatches = filter === "all" || category === filter;
      const searchMatches =
        !needle ||
        `${message.from} ${message.subject} ${message.preview} ${message.body}`
          .toLowerCase()
          .includes(needle);
      return categoryMatches && searchMatches;
    });
  }, [filter, query, workspace.messages]);
  const selected =
    visible.find((message) => message.id === selectedId) ?? visible[0] ?? null;
  const linkedApplication = selected?.applicationId
    ? workspace.applications.find(
        (item) => item.id === selected.applicationId,
      ) ?? null
    : null;
  const unread = workspace.messages.filter(
    (message) =>
      !message.read &&
      !isUnsolicitedJobMarketingMessage(
        message.subject,
        message.body,
        message.from,
      ),
  ).length;

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    void getSupabase()
      .auth.getSession()
      .then(async ({ data }) => {
        const token = data.session?.access_token;
        if (!token) throw new Error("No active session");
        const response = await fetch("/api/integrations/status", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Status unavailable");
        const payload = (await response.json()) as {
          integrations?: Array<{ id: string; state: string }>;
        };
        const email = payload.integrations?.find(
          (item) => item.id === "inbound_email",
        );
        if (active)
          setEmailState(email?.state === "connected" ? "connected" : "gated");
      })
      .catch(() => {
        if (active) setEmailState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const syncMessages = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetchWithFreshSession(
          "/api/integrations/email/inbox-sync",
          {
            method: "POST",
            cache: "no-store",
          },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as {
          messages?: InboxMessage[];
        };
        if (!active || !Array.isArray(payload.messages)) return;
        updateWorkspace((current) => ({
          ...current,
          messages: payload.messages as InboxMessage[],
        }));
      } catch {
        // The current inbox remains available if a background refresh fails.
      }
    };
    void syncMessages();
    timer = setInterval(() => void syncMessages(), 12_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void syncMessages();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  const selectMessage = (message: InboxMessage) => {
    setSelectedId(message.id);
    setMobileReading(true);
    if (!message.read)
      updateWorkspace((current) => ({
        ...current,
        messages: current.messages.map((item) =>
          item.id === message.id ? { ...item, read: true } : item,
        ),
      }));
  };

  const markAllRead = () => {
    updateWorkspace((current) => ({
      ...current,
      messages: current.messages.map((message) => ({ ...message, read: true })),
    }));
    setNotice("All messages marked as read.");
  };

  const activateInbox = async () => {
    setActivating(true);
    setNotice(null);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again to activate your inbox.");
      const response = await fetch("/api/integrations/email/alias", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = (await response.json()) as {
        alias?: string;
        forwardingEmail?: string;
        forwardingEnabled?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.alias)
        throw new Error(payload.error ?? "The inbox could not be activated.");
      updateWorkspace((current) => ({
        ...current,
        inbox: {
          ...current.inbox,
          alias: payload.alias as string,
          forwardingEmail:
            payload.forwardingEmail ?? current.inbox.forwardingEmail,
          forwardingEnabled: payload.forwardingEnabled ?? true,
          providerState: "connected",
        },
      }));
      setNotice("Your private recruiter address is ready.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The inbox could not be activated.",
      );
    } finally {
      setActivating(false);
    }
  };

  const copyAlias = async () => {
    await navigator.clipboard.writeText(workspace.inbox.alias);
    setNotice("Private address copied.");
  };

  const openComposer = (message: InboxMessage) => {
    setReplyMessage(message);
    setReplyRequestKey(crypto.randomUUID());
    setComposeMessage("");
    setComposeOpen(true);
    setNotice(null);
  };

  const sendMessage = async () => {
    setSending(true);
    setNotice(null);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again before sending a message.");
      const response = await fetch("/api/integrations/email/send", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": replyRequestKey,
        },
        body: JSON.stringify({
          replyToMessageId: replyMessage?.id,
          message: composeMessage,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "The message could not be sent.");
      setComposeOpen(false);
      setNotice("Message sent from your private IR35Careers address.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The message could not be sent.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <WorkspacePage
      eyebrow="Recruiter inbox"
      title="Your application messages"
      description="Recruiter replies, interviews and application updates, linked to the right contract."
    >
      <section
        className="ir35-card p-3 sm:p-4"
        aria-labelledby="inbox-connection-title"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${emailState === "connected" && hasAlias ? "bg-emerald-50 text-emerald-700" : "bg-brand-50 text-brand-700"}`}
            >
              <AtSign size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="inbox-connection-title"
                  className="text-sm font-semibold text-slate-950"
                >
                  Application email
                </h2>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${emailState === "connected" && hasAlias ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
                >
                  {emailState === "loading"
                    ? "Checking"
                    : hasAlias
                      ? "Active"
                      : "Not active"}
                </span>
              </div>
              <p className="mt-1 break-all font-mono text-xs font-semibold text-brand-800 sm:text-sm">
                {hasAlias ? workspace.inbox.alias : "Not created"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {emailState === "connected" && !hasAlias && (
              <button
                type="button"
                onClick={() => void activateInbox()}
                disabled={activating}
                className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-50"
              >
                {activating ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <MailCheck size={16} />
                )}{" "}
                Activate inbox
              </button>
            )}
            {hasAlias && (
              <button
                type="button"
                onClick={() => void copyAlias()}
                className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {notice === "Private address copied." ? (
                  <Check size={15} />
                ) : (
                  <Copy size={15} />
                )}{" "}
                Copy email
              </button>
            )}
            <button
              type="button"
              aria-expanded={identityOpen}
              onClick={() => setIdentityOpen((current) => !current)}
              className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              How it works{" "}
              <ChevronDown
                size={15}
                className={identityOpen ? "rotate-180" : ""}
              />
            </button>
          </div>
        </div>
        {identityOpen && (
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-600 sm:grid-cols-2">
            <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-brand-700" size={16} />
              Recruiter replies are linked automatically to the application that created them.
            </p>
            <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
              <Send className="mt-0.5 shrink-0 text-brand-700" size={16} />
              Important interviews, actions and outcomes are also sent to your account email.
            </p>
          </div>
        )}
        {(emailState === "gated" || emailState === "error") && (
          <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Application email is temporarily unavailable. Your existing messages
            and applications are safe.
          </p>
        )}
        {notice && (
          <p className="mt-4 text-sm font-medium text-brand-800" role="status">
            {notice}
          </p>
        )}
      </section>

      <section className="ir35-card mt-5 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search messages</span>
            <Search
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              size={17}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages, companies or roles"
              className="ir35-focus min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 pl-11 pr-4 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={markAllRead}
              disabled={unread === 0}
              className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              <CheckCheck size={16} /> Mark all read
            </button>
          </div>
        </div>
        <div
          className="mt-4 flex gap-2 overflow-x-auto pb-1"
          aria-label="Inbox filters"
        >
          {FILTERS.map((item) => {
            const count =
              item.id === "all"
                ? workspace.messages.length
                : workspace.messages.filter(
                    (message) => inboxViewCategory(message) === item.id,
                  ).length;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                onClick={() => { setFilter(item.id); setMobileReading(false); }}
                className={`ir35-focus inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold ${filter === item.id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                {item.label}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${filter === item.id ? "bg-white/15" : "bg-slate-100"}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="ir35-card mt-4 grid overflow-hidden lg:min-h-[560px] lg:grid-cols-[360px_1fr]">
        <div className={`${mobileReading ? "hidden" : "block"} border-b border-slate-200 lg:block lg:border-b-0 lg:border-r`}>
          {visible.length === 0 ? (
            <div className="p-8 text-center">
              <Inbox className="mx-auto text-slate-400" />
              <p className="mt-3 text-sm font-semibold text-slate-700">
                {filter === "all"
                  ? "No application messages yet"
                  : `No ${FILTERS.find((item) => item.id === filter)?.label ?? "matching"} messages`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {workspace.messages.length > 0
                  ? "Your messages are available in another category."
                  : "Application updates and recruiter replies will appear here automatically."}
              </p>
              {(filter !== "all" || query) && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                  className="ir35-focus mt-4 min-h-10 rounded-xl border border-slate-300 px-4 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  View all messages
                </button>
              )}
            </div>
          ) : (
            visible.map((message) => (
              <button
                key={message.id}
                type="button"
                onClick={() => selectMessage(message)}
                className={`ir35-focus block w-full border-b border-slate-100 p-4 text-left transition-colors ${selected?.id === message.id ? "bg-brand-50" : "hover:bg-slate-50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`truncate text-xs ${message.read ? "text-slate-500" : "font-bold text-slate-900"}`}
                  >
                    {message.from}
                  </span>
                  {!message.read && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-brand-600"
                      aria-label="Unread"
                    />
                  )}
                </div>
                <p
                  className={`mt-1 truncate text-sm ${message.read ? "font-medium text-slate-700" : "font-bold text-slate-950"}`}
                >
                  {message.subject}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                  {message.preview}
                </p>
                <div className="mt-2">
                  <CategoryPill message={message} />
                </div>
              </button>
            ))
          )}
        </div>
        <div className={`${mobileReading ? "block" : "hidden"} min-w-0 p-5 sm:p-8 lg:block`}>
          {selected ? (
            <article>
              <button type="button" onClick={() => setMobileReading(false)} className="ir35-focus mb-5 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 lg:hidden"><ArrowLeft size={14} /> Back to messages</button>
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CategoryPill message={selected} />
                  <h2 className="mt-3 text-xl font-semibold text-slate-950">
                    {selected.subject}
                  </h2>
                  <p className="mt-1 break-all text-sm text-slate-500">
                    From {selected.from}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  <p className="text-xs text-slate-500">
                    {new Date(selected.receivedAt).toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  {canReplyToMessage(selected) && (
                    <button
                      type="button"
                      onClick={() => openComposer(selected)}
                      disabled={!hasAlias}
                      className="ir35-focus inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 disabled:opacity-40"
                    >
                      <Reply size={14} /> Reply
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-6 whitespace-pre-line text-sm leading-7 text-slate-700">
                {selected.body}
              </div>
              {selected.applicationId && (
                <div className="mt-8 rounded-2xl border border-brand-200 bg-brand-50 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-brand-900">
                    <MailCheck size={16} /> Linked to{" "}
                    {linkedApplication?.job.title ?? "an application"}
                  </p>
                  {linkedApplication?.attention && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-white p-3">
                      <p className="text-xs font-bold text-amber-900">
                        {linkedApplication.attention.title}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-amber-800">
                        {linkedApplication.attention.message}
                      </p>
                    </div>
                  )}
                  <Link
                    href={
                      linkedApplication
                        ? linkedApplication.attention?.action.startsWith("/")
                          ? linkedApplication.attention.action
                          : `/applications/new/${linkedApplication.job.id}?applicationId=${encodeURIComponent(linkedApplication.id)}${linkedApplication.attention?.action.startsWith("#") ? linkedApplication.attention.action : linkedApplication.attention ? "#needs-attention" : ""}`
                        : "/applications"
                    }
                    className="ir35-focus mt-3 inline-flex min-h-10 items-center rounded-xl bg-white px-3 text-xs font-bold text-brand-800 shadow-sm"
                  >
                    {linkedApplication?.attention
                      ? linkedApplication.attention.actionLabel
                      : "Open application"}
                  </Link>
                </div>
              )}
            </article>
          ) : (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <CheckCircle2 className="mx-auto text-slate-300" size={32} />
                <p className="mt-3 text-sm text-slate-500">
                  Choose a message to read it.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {composeOpen && replyMessage && (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center sm:p-6"
          role="presentation"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="compose-title"
            className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-700">
                  Private application email
                </p>
                <h2
                  id="compose-title"
                  className="mt-1 text-xl font-semibold text-slate-950"
                >
                  Reply to recruiter
                </h2>
                <p className="mt-1 break-all text-xs text-slate-500">
                  To {replyMessage.from}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Re: {replyMessage.subject.replace(/^(?:\s*re\s*:\s*)+/i, "")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="ir35-focus flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600"
                aria-label="Close composer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-5 grid gap-4">
              <label className="text-sm font-semibold text-slate-800">
                Message
                <textarea
                  value={composeMessage}
                  onChange={(event) => setComposeMessage(event.target.value)}
                  rows={9}
                  maxLength={40_000}
                  className="ir35-focus mt-2 w-full resize-y rounded-xl border border-slate-300 p-3 font-normal leading-6"
                />
              </label>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="ir35-focus min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={sending || !replyRequestKey || !composeMessage.trim()}
                className="ir35-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Send size={16} />
                )}{" "}
                Send reply
              </button>
            </div>
          </section>
        </div>
      )}
    </WorkspacePage>
  );
}
