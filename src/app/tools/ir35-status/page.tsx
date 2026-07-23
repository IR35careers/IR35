"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ShieldQuestion, RotateCcw } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";

/**
 * Indicative IR35 status checker. Weighted questions on the established status
 * factors (control, substitution, mutuality of obligation, financial risk,
 * part-and-parcel, exclusivity, equipment). NOT a determination — points the
 * user to HMRC's CEST tool and professional review.
 *
 * Each answer maps to a signed weight: positive = points toward OUTSIDE
 * (genuine business-to-business), negative = points toward INSIDE (disguised
 * employment). Score is normalized to a 0–100 "outside likelihood".
 */

interface Q {
  id: string;
  question: string;
  help: string;
  // weight applied when answered "yes"; "no" applies the negation.
  weight: number;
}

const QUESTIONS: Q[] = [
  {
    id: "substitution",
    question: "Can you send a qualified substitute to do the work in your place?",
    help: "A genuine, unfettered right of substitution is one of the strongest indicators of being outside IR35.",
    weight: 3,
  },
  {
    id: "control",
    question: "Do you control how, when and where you do the work (not the client)?",
    help: "Being told what to do is normal; being told how, when and where to do it points toward employment.",
    weight: 2.5,
  },
  {
    id: "moo",
    question: "Is the client free to offer no further work, and you free to decline it?",
    help: "No ongoing obligation to offer or accept work (no 'mutuality of obligation') points outside IR35.",
    weight: 2,
  },
  {
    id: "financial_risk",
    question: "Do you carry real financial risk (fixing errors at your own cost, own insurance)?",
    help: "Correcting defective work unpaid, and holding professional indemnity insurance, indicate being in business on your own account.",
    weight: 1.5,
  },
  {
    id: "equipment",
    question: "Do you mainly provide your own equipment for the work?",
    help: "Using your own kit rather than the client's is a (weaker) pointer toward outside IR35.",
    weight: 1,
  },
  {
    id: "part_and_parcel",
    question: "Are you kept separate from the client's staff (not 'part and parcel' of their org)?",
    help: "Line-managing their staff, appraisals, or staff perks suggest you're integrated like an employee.",
    weight: 1.5,
  },
  {
    id: "exclusivity",
    question: "Are you free to work for other clients at the same time?",
    help: "Exclusivity to one client looks more like employment.",
    weight: 1,
  },
  {
    id: "in_business",
    question: "Do you market a business (website, other clients, own branding)?",
    help: "Trading as a genuine business, with multiple clients, marketing and a business identity, supports outside IR35.",
    weight: 1,
  },
];

type Answer = "yes" | "no" | "unsure";

export default function IR35StatusChecker() {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [submitted, setSubmitted] = useState(false);

  const maxScore = QUESTIONS.reduce((s, q) => s + q.weight, 0);
  const rawScore = QUESTIONS.reduce((s, q) => {
    const a = answers[q.id];
    if (a === "yes") return s + q.weight;
    if (a === "no") return s - q.weight;
    return s; // unsure = neutral
  }, 0);
  // Map [-max, +max] → [0, 100]
  const likelihood = Math.round(((rawScore + maxScore) / (2 * maxScore)) * 100);
  const answeredCount = QUESTIONS.filter((q) => answers[q.id]).length;

  const verdict =
    likelihood >= 65
      ? { label: "Likely Outside IR35", tone: "green" as const }
      : likelihood <= 40
        ? { label: "Likely Inside IR35", tone: "rose" as const }
        : { label: "Borderline: seek review", tone: "amber" as const };

  const reset = () => {
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link href="/tools" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={14} /> All tools
        </Link>
        <div className="mt-4 flex items-center gap-2">
          <ShieldQuestion className="text-green-600" size={22} />
          <h1 className="text-3xl font-semibold tracking-tight">IR35 Status Checker</h1>
        </div>
        <p className="mt-2 max-w-2xl text-slate-600">
          Answer these questions about your working arrangement for an <strong>indicative</strong>{" "}
          view of whether a contract looks inside or outside IR35.
        </p>

        {/* Questions */}
        <div className="mt-6 space-y-3">
          {QUESTIONS.map((q, i) => (
            <div key={q.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-sm font-medium text-slate-800">
                {i + 1}. {q.question}
              </p>
              <p className="mt-1 text-xs text-slate-500">{q.help}</p>
              <div className="mt-3 inline-flex rounded-lg border border-slate-200 p-0.5">
                {(["yes", "no", "unsure"] as Answer[]).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                    className={`rounded-md px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
                      answers[q.id] === opt ? "bg-green-600 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => setSubmitted(true)}
            disabled={answeredCount < QUESTIONS.length}
            className="rounded-xl bg-green-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            {answeredCount < QUESTIONS.length ? `Answer all (${answeredCount}/${QUESTIONS.length})` : "See result"}
          </button>
          {answeredCount > 0 && (
            <button onClick={reset} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>

        {/* Result */}
        {submitted && answeredCount === QUESTIONS.length && (
          <div
            className={`mt-6 rounded-2xl border p-6 ${
              verdict.tone === "green"
                ? "border-green-200 bg-green-50"
                : verdict.tone === "rose"
                  ? "border-rose-200 bg-rose-50"
                  : "border-amber-200 bg-amber-50"
            }`}
          >
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Indicative result</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{verdict.label}</p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white">
              <div
                className={`h-full ${verdict.tone === "green" ? "bg-green-600" : verdict.tone === "rose" ? "bg-rose-500" : "bg-amber-500"}`}
                style={{ width: `${likelihood}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-slate-600">{likelihood}% toward outside IR35 on your answers.</p>
            <p className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500">
              This is indicative guidance only. It is <strong>not a status determination</strong> and not
              legal or tax advice. IR35 turns on the true facts of your engagement and the written
              contract. For a formal view, use HMRC&apos;s{" "}
              <a className="text-green-700 underline" href="https://www.gov.uk/guidance/check-employment-status-for-tax" target="_blank" rel="noopener noreferrer">
                CEST tool
              </a>{" "}
              and consider an independent IR35 contract review.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/tools/take-home" className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400">
                Estimate your take-home →
              </Link>
              <Link href="/jobs?ir35=outside" className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700">
                See Outside IR35 contracts →
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
