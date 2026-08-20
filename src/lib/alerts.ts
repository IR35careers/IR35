export interface JobAlertFilter {
  id: string;
  name: string;
  q: string | null;
  ir35: string | null;
  remote: string | null;
  min_rate: number | null;
  skills: string[];
}

export function alertSearchParams(alert: JobAlertFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (alert.q) params.set("q", alert.q);
  if (alert.ir35) params.set("ir35", alert.ir35);
  if (alert.remote) params.set("remote", alert.remote);
  if (alert.min_rate && alert.min_rate > 0) params.set("min_rate", String(alert.min_rate));
  if (alert.skills.length > 0) params.set("skills", alert.skills.join(","));
  return params;
}

export function alertToSearch(alert: JobAlertFilter): string {
  const query = alertSearchParams(alert).toString();
  return query ? `/jobs?${query}` : "/jobs";
}

export function alertToPreviewApi(alert: JobAlertFilter, perPage = 3): string {
  const params = alertSearchParams(alert);
  params.set("per_page", String(Math.min(10, Math.max(1, Math.round(perPage)))));
  return `/api/jobs/search?${params.toString()}`;
}
