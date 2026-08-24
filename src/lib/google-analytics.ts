import { createSign } from "node:crypto";

export type AnalyticsMetricRow = { label: string; value: number; secondary?: string };
export type AnalyticsDailyRow = { date: string; activeUsers: number; sessions: number; pageViews: number };

export type GoogleAnalyticsSnapshot = {
  trackingConfigured: boolean;
  reportingConfigured: boolean;
  connected: boolean;
  measurementId: string | null;
  propertyId: string | null;
  error: string | null;
  period: { startDate: string; endDate: string };
  realtimeUsers: number;
  summary: {
    activeUsers: number;
    newUsers: number;
    sessions: number;
    pageViews: number;
    engagedSessions: number;
    bounceRate: number;
    averageSessionDuration: number;
  };
  daily: AnalyticsDailyRow[];
  countries: AnalyticsMetricRow[];
  cities: AnalyticsMetricRow[];
  devices: AnalyticsMetricRow[];
  sources: AnalyticsMetricRow[];
  pages: AnalyticsMetricRow[];
};

type DataApiValue = { value?: string };
type DataApiRow = { dimensionValues?: DataApiValue[]; metricValues?: DataApiValue[] };
type DataApiReport = { rows?: DataApiRow[]; totals?: DataApiRow[] };
type BatchReportResponse = { reports?: DataApiReport[] };

const DATE_RANGE = { startDate: "30daysAgo", endDate: "today" };

function integer(value?: string): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decimal(value?: string): number {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function analyticsRows(report: DataApiReport | undefined, label: (dimensions: string[]) => { label: string; secondary?: string }, limit = 10): AnalyticsMetricRow[] {
  return (report?.rows ?? []).slice(0, limit).map((row) => {
    const dimensions = (row.dimensionValues ?? []).map((item) => item.value || "Not set");
    return { ...label(dimensions), value: integer(row.metricValues?.[0]?.value) };
  });
}

function blankSnapshot(measurementId: string | null, propertyId: string | null): GoogleAnalyticsSnapshot {
  return {
    trackingConfigured: Boolean(measurementId),
    reportingConfigured: false,
    connected: false,
    measurementId,
    propertyId,
    error: null,
    period: { startDate: "30 days ago", endDate: "Today" },
    realtimeUsers: 0,
    summary: { activeUsers: 0, newUsers: 0, sessions: 0, pageViews: 0, engagedSessions: 0, bounceRate: 0, averageSessionDuration: 0 },
    daily: [],
    countries: [],
    cities: [],
    devices: [],
    sources: [],
    pages: [],
  };
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function serviceAccountToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey.replace(/\\n/g, "\n")).toString("base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Google Analytics service account authentication failed.");
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("Google Analytics did not return an access token.");
  return payload.access_token;
}

async function analyticsRequest<T>(url: string, token: string, body: object): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Analytics reporting failed (${response.status}): ${detail.slice(0, 180)}`);
  }
  return response.json() as Promise<T>;
}

export async function loadGoogleAnalyticsSnapshot(): Promise<GoogleAnalyticsSnapshot> {
  const measurementId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID?.trim() || null;
  const propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID?.trim() || null;
  const clientEmail = process.env.GOOGLE_ANALYTICS_CLIENT_EMAIL?.trim() || "";
  const privateKey = process.env.GOOGLE_ANALYTICS_PRIVATE_KEY?.trim() || "";
  const snapshot = blankSnapshot(measurementId, propertyId);
  snapshot.reportingConfigured = Boolean(propertyId && /^\d+$/.test(propertyId) && clientEmail && privateKey);
  if (!snapshot.reportingConfigured) return snapshot;

  try {
    const token = await serviceAccountToken(clientEmail, privateKey);
    const base = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}`;
    const commonMetrics = ["activeUsers", "newUsers", "sessions", "screenPageViews", "engagedSessions", "bounceRate", "averageSessionDuration"].map((name) => ({ name }));
    const [primary, secondary, realtime] = await Promise.all([
      analyticsRequest<BatchReportResponse>(`${base}:batchRunReports`, token, { requests: [
        { dateRanges: [DATE_RANGE], metrics: commonMetrics, metricAggregations: ["TOTAL"] },
        { dateRanges: [DATE_RANGE], dimensions: [{ name: "date" }], metrics: ["activeUsers", "sessions", "screenPageViews"].map((name) => ({ name })), orderBys: [{ dimension: { dimensionName: "date" } }], limit: 31 },
        { dateRanges: [DATE_RANGE], dimensions: [{ name: "country" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 10 },
        { dateRanges: [DATE_RANGE], dimensions: [{ name: "city" }, { name: "region" }, { name: "country" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 10 },
        { dateRanges: [DATE_RANGE], dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 10 },
      ] }),
      analyticsRequest<BatchReportResponse>(`${base}:batchRunReports`, token, { requests: [
        { dateRanges: [DATE_RANGE], dimensions: [{ name: "sessionSourceMedium" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 10 },
        { dateRanges: [DATE_RANGE], dimensions: [{ name: "pagePath" }, { name: "pageTitle" }], metrics: [{ name: "screenPageViews" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 10 },
      ] }),
      analyticsRequest<DataApiReport>(`${base}:runRealtimeReport`, token, { metrics: [{ name: "activeUsers" }] }),
    ]);

    const total = primary.reports?.[0]?.totals?.[0] ?? primary.reports?.[0]?.rows?.[0];
    const metrics = total?.metricValues ?? [];
    snapshot.connected = true;
    snapshot.realtimeUsers = integer(realtime.rows?.[0]?.metricValues?.[0]?.value);
    snapshot.summary = {
      activeUsers: integer(metrics[0]?.value),
      newUsers: integer(metrics[1]?.value),
      sessions: integer(metrics[2]?.value),
      pageViews: integer(metrics[3]?.value),
      engagedSessions: integer(metrics[4]?.value),
      bounceRate: Math.round(decimal(metrics[5]?.value) * 1000) / 10,
      averageSessionDuration: Math.round(decimal(metrics[6]?.value)),
    };
    snapshot.daily = (primary.reports?.[1]?.rows ?? []).map((row) => ({
      date: row.dimensionValues?.[0]?.value || "",
      activeUsers: integer(row.metricValues?.[0]?.value),
      sessions: integer(row.metricValues?.[1]?.value),
      pageViews: integer(row.metricValues?.[2]?.value),
    }));
    snapshot.countries = analyticsRows(primary.reports?.[2], ([country]) => ({ label: country }));
    snapshot.cities = analyticsRows(primary.reports?.[3], ([city, region, country]) => ({ label: city, secondary: [region, country].filter(Boolean).join(", ") }));
    snapshot.devices = analyticsRows(primary.reports?.[4], ([device]) => ({ label: device }));
    snapshot.sources = analyticsRows(secondary.reports?.[0], ([source]) => ({ label: source }));
    snapshot.pages = analyticsRows(secondary.reports?.[1], ([path, title]) => ({ label: path, secondary: title }));
  } catch (error) {
    snapshot.error = error instanceof Error ? error.message : "Google Analytics reporting is unavailable.";
  }
  return snapshot;
}
