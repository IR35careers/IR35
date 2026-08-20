import type { ApplicationRecord, ApplicationStatus, WorkspaceState } from "@/lib/workspace/types";
import { countDueFollowUps } from "@/lib/workspace/network";

const SUBMITTED = new Set<ApplicationStatus>(["applied", "viewed", "replied", "interview", "offer", "rejected", "withdrawn"]);
const RESPONDED = new Set<ApplicationStatus>(["replied", "interview", "offer", "rejected"]);
const INTERVIEWED = new Set<ApplicationStatus>(["interview", "offer"]);
const ACTIVE = new Set<ApplicationStatus>(["draft", "needs_review", "ready", "applied", "viewed", "replied", "interview"]);

export interface AnalyticsBreakdown {
  id: string;
  label: string;
  count: number;
  percentage: number;
}

export interface AnalyticsWeek {
  label: string;
  start: string;
  applications: number;
  responses: number;
}

export interface AnalyticsSnapshot {
  total: number;
  active: number;
  submitted: number;
  responses: number;
  interviews: number;
  offers: number;
  responseRate: number;
  interviewRate: number;
  offerRate: number;
  averageMatch: number;
  averageKnownDayRate: number | null;
  averageResponseDays: number | null;
  funnel: AnalyticsBreakdown[];
  ir35: AnalyticsBreakdown[];
  workplaces: AnalyticsBreakdown[];
  sources: AnalyticsBreakdown[];
  weeks: AnalyticsWeek[];
  staleActive: number;
  unreadMessages: number;
  dueFollowUps: number;
  insights: string[];
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function asBreakdown(values: Array<{ id: string; label: string }>, applications: ApplicationRecord[], read: (application: ApplicationRecord) => string): AnalyticsBreakdown[] {
  return values.map((value) => {
    const count = applications.filter((application) => read(application) === value.id).length;
    return { ...value, count, percentage: percentage(count, applications.length) };
  });
}

function sourceBreakdown(applications: ApplicationRecord[]): AnalyticsBreakdown[] {
  const counts = new Map<string, number>();
  for (const application of applications) {
    const source = application.job.source_domain?.replace(/^www\./, "") || "Unknown source";
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([label, count]) => ({ id: label, label, count, percentage: percentage(count, applications.length) }));
}

function responseAt(application: ApplicationRecord): number | null {
  const event = application.events
    .filter((item) => item.type === "message_received" || /repl|interview|reject|offer/i.test(item.label))
    .map((item) => new Date(item.createdAt).getTime())
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  return event ?? null;
}

function averageResponseDays(applications: ApplicationRecord[]): number | null {
  const durations = applications.flatMap((application) => {
    const response = responseAt(application);
    const created = new Date(application.createdAt).getTime();
    if (response === null || !Number.isFinite(created) || response < created) return [];
    return [(response - created) / 86_400_000];
  });
  if (durations.length === 0) return null;
  return Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10;
}

function startOfWeek(value: Date): Date {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date;
}

function weeklyActivity(applications: ApplicationRecord[], now: Date): AnalyticsWeek[] {
  const current = startOfWeek(now);
  return Array.from({ length: 8 }, (_, index) => {
    const start = new Date(current);
    start.setUTCDate(start.getUTCDate() - (7 - index) * 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const inWeek = applications.filter((application) => {
      const created = new Date(application.createdAt).getTime();
      return created >= start.getTime() && created < end.getTime();
    });
    const responses = applications.filter((application) => {
      const timestamp = responseAt(application);
      return timestamp !== null && timestamp >= start.getTime() && timestamp < end.getTime();
    }).length;
    return {
      label: start.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
      start: start.toISOString().slice(0, 10),
      applications: inWeek.length,
      responses,
    };
  });
}

export function buildAnalyticsSnapshot(workspace: WorkspaceState, now = new Date()): AnalyticsSnapshot {
  const applications = workspace.applications;
  const submitted = applications.filter((item) => SUBMITTED.has(item.status)).length;
  const responses = applications.filter((item) => RESPONDED.has(item.status) || responseAt(item) !== null).length;
  const interviews = applications.filter((item) => INTERVIEWED.has(item.status)).length;
  const offers = applications.filter((item) => item.status === "offer").length;
  const active = applications.filter((item) => ACTIVE.has(item.status)).length;
  const averageMatch = applications.length > 0 ? Math.round(applications.reduce((sum, item) => sum + item.matchScore, 0) / applications.length) : 0;
  const dailyRates = applications.flatMap((item) => item.job.rate_type === "daily" ? [item.job.rate_max ?? item.job.rate_min].filter((value): value is number => value !== null) : []);
  const averageKnownDayRate = dailyRates.length > 0 ? Math.round(dailyRates.reduce((sum, value) => sum + value, 0) / dailyRates.length) : null;
  const fourteenDaysAgo = now.getTime() - 14 * 86_400_000;
  const staleActive = applications.filter((item) => ACTIVE.has(item.status) && new Date(item.updatedAt).getTime() < fourteenDaysAgo).length;
  const unreadMessages = workspace.messages.filter((message) => !message.read).length;
  const dueFollowUps = countDueFollowUps(workspace.profile.networkContacts ?? [], now);

  const funnelCounts = [
    { id: "prepared", label: "Prepared", count: applications.length },
    { id: "submitted", label: "Applied", count: submitted },
    { id: "responses", label: "Responses", count: responses },
    { id: "interviews", label: "Interviews", count: interviews },
    { id: "offers", label: "Offers", count: offers },
  ];
  const funnel = funnelCounts.map((item) => ({ ...item, percentage: percentage(item.count, applications.length) }));

  const responseRate = percentage(responses, submitted);
  const interviewRate = percentage(interviews, submitted);
  const offerRate = percentage(offers, submitted);
  const insights: string[] = [];
  if (applications.length === 0) insights.push("Prepare your first role-specific application to start measuring outcomes.");
  if (applications.length > 0 && averageMatch < 70) insights.push("Average CV match is below 70%; review evidence gaps before preparing more applications.");
  if (submitted >= 3 && responseRate < 20) insights.push("Response rate is below 20%; prioritise closer-fit roles and review the opening third of your CV.");
  if (interviews > 0) insights.push(`${interviewRate}% of submitted applications reached interview or offer stage.`);
  if (staleActive > 0) insights.push(`${staleActive} active application${staleActive === 1 ? " has" : "s have"} not changed for 14 days.`);
  if (unreadMessages > 0) insights.push(`${unreadMessages} recruiter message${unreadMessages === 1 ? " needs" : "s need"} review.`);
  if (dueFollowUps > 0) insights.push(`${dueFollowUps} networking follow-up${dueFollowUps === 1 ? " is" : "s are"} due.`);
  if (insights.length === 0) insights.push("Your pipeline has no immediate review signals.");

  return {
    total: applications.length,
    active,
    submitted,
    responses,
    interviews,
    offers,
    responseRate,
    interviewRate,
    offerRate,
    averageMatch,
    averageKnownDayRate,
    averageResponseDays: averageResponseDays(applications),
    funnel,
    ir35: asBreakdown([
      { id: "outside", label: "Outside IR35" },
      { id: "inside", label: "Inside IR35" },
      { id: "unknown", label: "IR35 TBC" },
    ], applications, (item) => item.job.ir35_status),
    workplaces: asBreakdown([
      { id: "remote", label: "Remote" },
      { id: "hybrid", label: "Hybrid" },
      { id: "onsite", label: "On-site" },
      { id: "unknown", label: "Not stated" },
    ], applications, (item) => item.job.remote_type),
    sources: sourceBreakdown(applications),
    weeks: weeklyActivity(applications, now),
    staleActive,
    unreadMessages,
    dueFollowUps,
    insights,
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function analyticsCsv(workspace: WorkspaceState): string {
  const header = ["Application ID", "Role", "Company", "Status", "IR35", "Workplace", "Match score", "Rate type", "Rate min", "Rate max", "Source", "Created", "Updated"];
  const rows = workspace.applications.map((item) => [
    item.id,
    item.job.title,
    item.job.company_name,
    item.status,
    item.job.ir35_status,
    item.job.remote_type,
    item.matchScore,
    item.job.rate_type,
    item.job.rate_min ?? "",
    item.job.rate_max ?? "",
    item.job.source_domain ?? "",
    item.createdAt,
    item.updatedAt,
  ]);
  return [header, ...rows].map((row) => row.map((cell) => csvCell(cell)).join(",")).join("\n");
}
