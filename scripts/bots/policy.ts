import { z } from "zod";

export const REPOSITORY = "IR35careers/IR35";
export const TEST_ACCOUNT = "anvesh.mannuru+ir35test@gmail.com";
export const BOT_LABELS = ["qa-bot", "seo-bot", "support", "new-sources", "x-growth"] as const;
export const numberSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const labels = z.array(z.object({ name: z.string().max(100) })).max(100);
export const issueSchema = z.object({ number: numberSchema, state: z.enum(["open", "closed"]), title: z.string().max(1000),
  body: z.string().max(65_536).nullable(), labels, updated_at: z.iso.datetime(), pull_request: z.unknown().optional() });
export const prSchema = z.object({ number: numberSchema, state: z.enum(["open", "closed"]), draft: z.boolean(),
  body: z.string().max(65_536).nullable(), labels,
  head: z.object({ sha: shaSchema, ref: z.string().max(255), repo: z.object({ full_name: z.string() }).nullable() }),
  base: z.object({ ref: z.string(), repo: z.object({ full_name: z.literal(REPOSITORY) }) }) });
export type BotIssue = z.infer<typeof issueSchema>;
export type BotPr = z.infer<typeof prSchema>;

export function linkedIssue(body: unknown): number | null {
  const text = z.string().max(65_536).nullable().parse(body) ?? "";
  const visible = text.replace(/\x60{3}[\s\S]*?\x60{3}/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const matches = [...visible.matchAll(/^\s*Fixes\s+#([1-9]\d*)\s*[.!]?\s*$/gim)];
  const found = [...new Set(matches.map(match => Number(match[1])))];
  return found.length === 1 && numberSchema.safeParse(found[0]).success ? found[0] : null;
}
export function formField(body: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp("^### " + escaped + "\\r?\\n+([\\s\\S]*?)(?=^### |$(?![\\s\\S]))", "m"))?.[1]?.trim() ?? "";
}
export function issueLabels(input: unknown): string[] {
  const issue = issueSchema.parse(input); const body = issue.body ?? "";
  const reporter = formField(body, "Reporter bot");
  const names: Record<string, string> = { "QA Bot": "qa-bot", "SEO Bot": "seo-bot", "Support Bot": "support", "Source Curator Bot": "new-sources", "X Growth Bot": "x-growth" };
  const result = names[reporter] ? [names[reporter]] : [];
  const priority = formField(body, "Priority");
  if (/^P[012]$/.test(priority)) result.push(priority);
  return result;
}
const meaningful = (value: string) => value.length >= 12 && !/^(_No response_|n\/?a|none|todo|\.\.\.)$/i.test(value);
export function handoffProblem(input: unknown): string | null {
  const issue = issueSchema.parse(input); const names = issue.labels.map(label => label.name); const body = issue.body ?? "";
  if (!names.includes("codex-ready")) return "The issue is not labelled codex-ready.";
  if (names.includes("needs-human")) return "This issue requires the owner.";
  const priority = names.filter(name => /^P[012]$/.test(name));
  if (priority.length !== 1 || !["P0", "P1"].includes(priority[0])) return "Only a single P0/P1 priority qualifies for automatic handoff.";
  const reproduction = formField(body, "Steps to reproduce") || formField(body, "Check that failed") || formField(body, "Evidence and verification steps");
  const evidence = formField(body, "Screenshot/log") || formField(body, "Evidence") || formField(body, "Evidence and verification steps");
  if (!meaningful(reproduction) || !meaningful(evidence)) return "Please add precise reproduction/verification steps and redacted evidence.";
  if (formField(body, "Account used") && formField(body, "Account used") !== TEST_ACCOUNT) return "Use only the designated test account.";
  const sensitive = [issue.title, reproduction, formField(body, "Actual"), formField(body, "Suggested fix")].join("\n");
  if (/\b(auth(?:entication)?|oauth|billing|stripe|secrets?|passwords?|schema|migrations?|production (?:settings|env|data))\b/i.test(sensitive))
    return "Auth, billing, secrets, schema or production-setting work needs the owner, not an automated handoff.";
  return null;
}
export function sensitiveFiles(input: unknown): boolean {
  const files = z.array(z.object({ filename: z.string().max(1000), patch: z.string().max(200_000).optional() })).max(3000).parse(input);
  return files.some(file => /(^|\/)(?:\.github|\.env[^/]*|supabase|infra|auth|billing|account|settings)(\/|$)|(?:supabase|stripe|secret|auth-|auth\.)|^scripts\/bots\/|^vercel\./i.test(file.filename)
    || /APPLICATION_WORKER_ACCEPT_JOBS|APPLY_RUNNER|SUPABASE_SECRET|OPENAI_API_KEY/.test(file.patch ?? ""));
}
export function botBranch(input: unknown, issue: number) {
  return new RegExp("^codex/issue-" + numberSchema.parse(issue) + "-[a-z0-9]+(?:-[a-z0-9]+)*$").test(z.string().max(255).parse(input));
}
export function eligiblePreview(input: unknown) {
  const value = z.object({ enabled: z.boolean(), prefix: z.string().regex(/^[a-z0-9][a-z0-9-]{2,50}$/),
    deployment: z.object({ sha: shaSchema, environment: z.literal("Preview"), production_environment: z.literal(false),
      creator: z.object({ login: z.literal("vercel[bot]") }) }),
    status: z.object({ state: z.literal("success"), creator: z.object({ login: z.literal("vercel[bot]") }), environment_url: z.url() }),
    pr: prSchema }).safeParse(input);
  if (!value.success || !value.data.enabled) return null;
  const { prefix, deployment, status, pr } = value.data;
  const issue = linkedIssue(pr.body);
  if (!issue || pr.state !== "open" || !pr.draft || pr.base.ref !== "main" || pr.head.repo?.full_name !== REPOSITORY
    || pr.labels.some(label => label.name === "needs-human") || pr.head.sha !== deployment.sha || !botBranch(pr.head.ref, issue)) return null;
  const url = new URL(status.environment_url);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !new RegExp("^" + prefix + "-[a-z0-9-]+\\.vercel\\.app$").test(url.hostname)) return null;
  return { number: pr.number, sha: pr.head.sha, url: url.origin, issue };
}
export function staleBotIssue(input: unknown, now: number) {
  const issue = issueSchema.parse(input); const names = issue.labels.map(label => label.name);
  return issue.state === "open" && !issue.pull_request && names.includes("triage") && BOT_LABELS.some(name => names.includes(name))
    && !["codex-ready", "codex-working", "needs-human"].some(name => names.includes(name))
    && Number.isSafeInteger(now) && now - Date.parse(issue.updated_at) > 21 * 86_400_000;
}
