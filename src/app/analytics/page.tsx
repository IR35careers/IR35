"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, BarChart3, Clock3, Download, Gauge, Lightbulb, MessageSquareText, PoundSterling, Target, Trophy } from "lucide-react";
import { WorkspacePage } from "@/components/workspace/WorkspacePage";
import { analyticsCsv, buildAnalyticsSnapshot, type AnalyticsBreakdown } from "@/lib/workspace/analytics";
import { useWorkspaceState } from "@/lib/workspace/store";

function saveCsv(csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ir35careers-application-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Breakdown({ title, items }: { title: string; items: AnalyticsBreakdown[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
      <h2 className="font-bold text-slate-950">{title}</h2>
      <div className="mt-5 space-y-4">
        {items.map((item) => (
          <div key={item.id}>
            <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-slate-700">{item.label}</span><span className="tabular-nums text-slate-500">{item.count} · {item.percentage}%</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label={`${item.label}: ${item.count} applications`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.percentage}><div className="h-full rounded-full bg-brand-600" style={{ width: `${item.percentage}%` }} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AnalyticsPage() {
  const workspace = useWorkspaceState();
  const analytics = useMemo(() => buildAnalyticsSnapshot(workspace), [workspace]);
  const peakWeek = Math.max(1, ...analytics.weeks.flatMap((week) => [week.applications, week.responses]));

  const stats = [
    { icon: Target, label: "Prepared", value: analytics.total, note: `${analytics.active} active` },
    { icon: MessageSquareText, label: "Response rate", value: `${analytics.responseRate}%`, note: `${analytics.responses} responses` },
    { icon: Trophy, label: "Interview rate", value: `${analytics.interviewRate}%`, note: `${analytics.interviews} interview or offer` },
    { icon: Gauge, label: "Average Resume match", value: `${analytics.averageMatch}%`, note: "Advisory, not a hiring prediction" },
    { icon: PoundSterling, label: "Average known day rate", value: analytics.averageKnownDayRate ? `£${analytics.averageKnownDayRate}` : "N/A", note: "Daily-rate roles only" },
    { icon: Clock3, label: "Average response time", value: analytics.averageResponseDays === null ? "N/A" : `${analytics.averageResponseDays}d`, note: "From preparation to first recorded reply" },
  ];

  return (
    <WorkspacePage
      eyebrow="Application analytics"
      title="See what is moving your contract search forward"
      description="A private, descriptive view of the applications, outcomes and follow-ups already in your workspace. Metrics explain past activity; they do not predict hiring decisions."
      actions={<div className="flex flex-wrap gap-2"><Link href="/applications" className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">Open pipeline <ArrowRight size={15} /></Link><button type="button" onClick={() => saveCsv(analyticsCsv(workspace))} className="ir35-focus inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white"><Download size={16} /> Export CSV</button></div>}
    >
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-6" aria-label="Application analytics summary">
        {stats.map((stat) => <article key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><stat.icon size={19} className="text-brand-700" /><p className="mt-4 text-2xl font-bold tabular-nums text-slate-950">{stat.value}</p><p className="mt-1 text-sm font-semibold text-slate-700">{stat.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{stat.note}</p></article>)}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><BarChart3 size={19} className="text-brand-700" /> Application funnel</h2><p className="mt-1 text-sm text-slate-600">Each stage is measured against all prepared applications.</p></div><p className="text-xs font-semibold text-slate-500">Offer rate: {analytics.offerRate}%</p></div>
          <div className="mt-6 space-y-4">{analytics.funnel.map((stage, index) => <div key={stage.id} className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_90px] sm:items-center"><p className="text-sm font-bold text-slate-700">{stage.label}</p><div className="h-9 overflow-hidden rounded-xl bg-slate-100" role="progressbar" aria-label={`${stage.label}: ${stage.count}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={stage.percentage}><div className={`flex h-full min-w-2 items-center rounded-xl px-3 text-xs font-bold text-white ${index === analytics.funnel.length - 1 ? "bg-emerald-500" : "bg-slate-950"}`} style={{ width: `${Math.max(stage.percentage, stage.count > 0 ? 8 : 0)}%` }}>{stage.count > 0 && stage.percentage >= 22 ? `${stage.percentage}%` : ""}</div></div><p className="text-right text-sm tabular-nums text-slate-500">{stage.count} roles</p></div>)}</div>
          {analytics.total === 0 && <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center"><p className="font-semibold text-slate-800">No applications to measure yet</p><p className="mt-1 text-sm text-slate-600">Prepare a role-specific packet to start the funnel.</p><Link href="/jobs" className="ir35-focus mt-4 inline-flex min-h-11 items-center rounded-xl bg-slate-950 px-4 text-sm font-bold text-white">Browse contracts</Link></div>}
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-amber-700"><Lightbulb size={20} /></span><div><h2 className="font-bold text-amber-950">Review signals</h2><p className="text-sm text-amber-800">Rules based on your recorded activity</p></div></div>
          <ul className="mt-5 space-y-3">{analytics.insights.map((insight) => <li key={insight} className="rounded-2xl border border-amber-200/80 bg-white/80 p-4 text-sm leading-6 text-amber-950">{insight}</li>)}</ul>
          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-amber-200 pt-5 text-center"><div><p className="text-xl font-bold tabular-nums">{analytics.staleActive}</p><p className="text-[11px] text-amber-800">Stale roles</p></div><div><p className="text-xl font-bold tabular-nums">{analytics.unreadMessages}</p><p className="text-[11px] text-amber-800">Unread</p></div><div><p className="text-xl font-bold tabular-nums">{analytics.dueFollowUps}</p><p className="text-[11px] text-amber-800">Follow-ups</p></div></div>
        </section>
      </div>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-bold text-slate-950">Eight-week activity</h2><p className="mt-1 text-sm text-slate-600">Prepared applications and first recorded responses by week.</p></div><div className="flex gap-4 text-xs font-semibold text-slate-600"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-brand-600" /> Prepared</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-slate-950" /> Responses</span></div></div>
        <div className="mt-6 grid min-h-52 grid-cols-8 gap-2" aria-label="Eight-week application activity chart">{analytics.weeks.map((week) => <div key={week.start} className="flex min-w-0 flex-col justify-end"><div className="flex h-40 items-end justify-center gap-1 rounded-xl bg-slate-50 px-1.5 pt-3"><div title={`${week.applications} prepared`} className="w-3 rounded-t bg-brand-600" style={{ height: `${Math.max(week.applications > 0 ? 8 : 0, (week.applications / peakWeek) * 100)}%` }} /><div title={`${week.responses} responses`} className="w-3 rounded-t bg-slate-950" style={{ height: `${Math.max(week.responses > 0 ? 8 : 0, (week.responses / peakWeek) * 100)}%` }} /></div><p className="mt-2 truncate text-center text-[10px] font-semibold text-slate-500">{week.label}</p></div>)}</div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3"><Breakdown title="IR35 mix" items={analytics.ir35} /><Breakdown title="Working pattern" items={analytics.workplaces} /><Breakdown title="Role sources" items={analytics.sources.length > 0 ? analytics.sources : [{ id: "none", label: "No source data", count: 0, percentage: 0 }]} /></div>

      <section className="mt-6 rounded-3xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-950 sm:p-6"><h2 className="font-bold">How these numbers are calculated</h2><p className="mt-2">Response, interview and offer rates use applications marked as applied as the denominator. A response is a recorded reply, interview, offer, rejection or linked recruiter-message event. Average response time runs from packet creation to the first recorded response. CSV export contains role and pipeline fields only. It never includes Resume text, screening answers or message bodies.</p></section>
    </WorkspacePage>
  );
}
