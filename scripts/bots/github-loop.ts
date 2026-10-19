import { z } from "zod";
import { REPOSITORY, botBranch, eligiblePreview, handoffProblem, issueLabels, issueSchema, linkedIssue, numberSchema, prSchema, sensitiveFiles, shaSchema, staleBotIssue } from "./policy";

export type Api = (path: string, method?: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown) => Promise<unknown>;
const root = "/repos/" + REPOSITORY;
const collection = (input: unknown) => z.array(z.unknown()).max(100).parse(input);
async function pages(api: Api, path: string, maximum = 30): Promise<unknown[]> {
  const result: unknown[] = [];
  for (let page = 1; page <= maximum; page++) {
    const batch = collection(await api(path + (path.includes("?") ? "&" : "?") + "per_page=100&page=" + page));
    result.push(...batch); if (batch.length < 100) return result;
  }
  throw new Error("Pagination limit reached; owner review required.");
}
const addLabels = (api: Api, number: number, labels: string[]) => api(root + "/issues/" + number + "/labels", "POST", { labels });
async function removeLabel(api: Api, number: number, label: string, existing: { name: string }[]) {
  if (existing.some(value => value.name === label)) await api(root + "/issues/" + number + "/labels/" + encodeURIComponent(label), "DELETE");
}
async function comment(api: Api, number: number, key: string, text: string) {
  const marker = "<!-- ir35-bots:" + key + " -->";
  const comments = z.array(z.object({ id: numberSchema, body: z.string(), user: z.object({ login: z.string() }) }))
    .parse(await pages(api, root + "/issues/" + number + "/comments"));
  const current = comments.find(value => value.user.login === "github-actions[bot]" && value.body.startsWith(marker));
  const body = marker + "\n" + text;
  if (current?.body === body) return;
  await api(current ? root + "/issues/comments/" + current.id : root + "/issues/" + number + "/comments",
    current ? "PATCH" : "POST", { body });
}
export async function syncIssue(api: Api, input: unknown) {
  const number = z.object({ issue: z.object({ number: numberSchema }) }).parse(input).issue.number;
  const issue = issueSchema.parse(await api(root + "/issues/" + number));
  if (issue.pull_request || issue.state !== "open") return;
  // Never override or contradict an explicit priority already chosen by the owner.
  const hasPriority = issue.labels.some(value => /^P[012]$/.test(value.name));
  const generated = issueLabels(issue).filter(value => !hasPriority || !/^P[012]$/.test(value));
  const labels = [...new Set([...issue.labels.map(value => value.name), ...generated])];
  const missing = generated.filter(value => !issue.labels.some(label => label.name === value));
  if (missing.length) await addLabels(api, number, missing);
  if (!labels.includes("codex-ready")) return;
  const problem = handoffProblem({ ...issue, labels: labels.map(name => ({ name })) });
  if (problem) {
    await addLabels(api, number, ["needs-human"]);
    await comment(api, number, "handoff-evidence", problem + "\nNo task was started by this workflow. The owner must re-triage.");
  }
}
export async function syncPr(api: Api, input: unknown) {
  const event = z.object({ action: z.string(), pull_request: z.object({ number: numberSchema }) }).parse(input);
  const pr = prSchema.parse(await api(root + "/pulls/" + event.pull_request.number));
  const issueNumber = linkedIssue(pr.body);
  if (!issueNumber || !botBranch(pr.head.ref, issueNumber) || pr.state !== "open" || pr.head.repo?.full_name !== REPOSITORY) return;
  if (event.action === "synchronize") {
    await removeLabel(api, pr.number, "preview-pass", pr.labels);
    await removeLabel(api, pr.number, "preview-fail", pr.labels);
  }
  const issue = issueSchema.parse(await api(root + "/issues/" + issueNumber));
  const files = await pages(api, root + "/pulls/" + pr.number + "/files");
  const problem = handoffProblem(issue) ?? (!pr.draft ? "Bot handoffs must remain draft until the owner takes over." : sensitiveFiles(files) ? "Sensitive files need the owner's direct review; do not automatically mention Codex." : null);
  if (problem) {
    await addLabels(api, issueNumber, ["needs-human"]); await addLabels(api, pr.number, ["needs-human"]);
    await comment(api, pr.number, "handoff-gate", problem); return;
  }
  await addLabels(api, issueNumber, ["codex-working"]);
}

export async function selectPreview(api: Api, input: unknown, config: { enabled: boolean; prefix: string }) {
  const event = z.object({ deployment: z.object({ id: numberSchema }), deployment_status: z.object({ id: numberSchema }) }).parse(input);
  if (!config.enabled) return null;
  const deployment = z.object({ sha: shaSchema }).passthrough().parse(await api(root + "/deployments/" + event.deployment.id));
  const statuses = collection(await api(root + "/deployments/" + event.deployment.id + "/statuses?per_page=100"));
  const latest = z.object({ id: numberSchema }).passthrough().parse(statuses[0]);
  if (latest.id !== event.deployment_status.id) return null;
  const prs = z.array(prSchema).parse(await pages(api, root + "/pulls?state=open&base=main"));
  const selections = prs.map(pr => eligiblePreview({ ...config, deployment, status: latest, pr })).filter(value => value !== null);
  if (selections.length !== 1) return null;
  const selected = selections[0]!;
  const issue = issueSchema.parse(await api(root + "/issues/" + selected.issue));
  if (handoffProblem(issue) || sensitiveFiles(await pages(api, root + "/pulls/" + selected.number + "/files"))) return null;
  return selected;
}
const runSchema = z.object({ id: numberSchema, run_attempt: numberSchema, head_sha: shaSchema, event: z.enum(["pull_request", "deployment_status"]),
  status: z.literal("completed"), path: z.literal(".github/workflows/pr-checks.yml"),
  head_repository: z.object({ full_name: z.literal(REPOSITORY) }),
  html_url: z.string().startsWith("https://github.com/" + REPOSITORY + "/actions/runs/") });
export async function reportChecks(api: Api, input: unknown) {
  const event = z.object({ workflow_run: z.object({ id: numberSchema, run_attempt: numberSchema }) }).parse(input);
  const run = runSchema.parse(await api(root + "/actions/runs/" + event.workflow_run.id));
  if (run.run_attempt !== event.workflow_run.run_attempt) return;
  const history = z.object({ workflow_runs: z.array(z.object({ id: numberSchema })) }).parse(await api(root + "/actions/workflows/pr-checks.yml/runs?head_sha=" + run.head_sha + "&event=" + run.event + "&per_page=1"));
  if (history.workflow_runs[0]?.id !== run.id) return;
  const jobs = z.object({ jobs: z.array(z.object({ name: z.string(), conclusion: z.string().nullable() })).max(100) })
    .parse(await api(root + "/actions/runs/" + run.id + "/jobs?filter=latest&per_page=100")).jobs;
  const kind = run.event === "deployment_status" ? "preview" : "code";
  const matches = jobs.filter(job => job.name === (kind === "preview" ? "preview-smoke" : "pr-checks"));
  if (matches.length !== 1 || !["success", "failure", "cancelled", "timed_out"].includes(matches[0].conclusion ?? "")) return;
  const passed = matches[0].conclusion === "success";
  const prs = z.array(prSchema).parse(await pages(api, root + "/pulls?state=open&base=main"));
  for (const pr of prs.filter(value => value.head.repo?.full_name === REPOSITORY && value.head.sha === run.head_sha)) {
    const number = linkedIssue(pr.body);
    if (!number || !botBranch(pr.head.ref, number)) continue;
    const fresh = prSchema.parse(await api(root + "/pulls/" + pr.number));
    if (fresh.head.sha !== run.head_sha || fresh.state !== "open") continue;
    if (kind === "preview" && fresh.labels.some(label => label.name === "needs-human")) continue;
    if (kind === "preview" && sensitiveFiles(await pages(api, root + "/pulls/" + pr.number + "/files"))) {
      await addLabels(api, pr.number, ["needs-human"]); continue;
    }
    await comment(api, pr.number, kind + "-checks", (passed ? "PASS" : "FAIL") + " — " + kind + " checks for " + run.head_sha + ".\n" +
      "[Run and logs](" + run.html_url + ")\n" + (kind === "preview" ? "Automated smoke is not human QA approval. QA Bot must follow the Test plan and attach redacted screenshots; only the owner merges." : "Preview smoke is a separate deployment-status run; passing code checks is not preview approval."));
    if (kind === "preview") {
      await removeLabel(api, pr.number, passed ? "preview-fail" : "preview-pass", fresh.labels);
      await addLabels(api, pr.number, passed ? ["preview-pass"] : ["preview-fail", "needs-human"]);
    }
  }
}
export async function closeStale(api: Api, now: number) {
  const issues = z.array(issueSchema).parse(await pages(api, root + "/issues?state=open&labels=triage&sort=updated&direction=asc"));
  const prs = z.array(prSchema).parse(await pages(api, root + "/pulls?state=open&base=main"));
  const active = new Set(prs.map(pr => linkedIssue(pr.body)).filter(value => value !== null));
  let closed = 0;
  for (const issue of issues) {
    if (closed >= 50) break;
    if (!staleBotIssue(issue, now) || active.has(issue.number)) continue;
    const fresh = issueSchema.parse(await api(root + "/issues/" + issue.number));
    if (fresh.updated_at !== issue.updated_at || !staleBotIssue(fresh, now)) continue;
    await api(root + "/issues/" + issue.number + "/comments", "POST", {
      body: "Closing this bot-filed triage report after more than 21 days without activity. It was not marked codex-ready, codex-working or needs-human and has no open linked PR. Reopen with fresh evidence if it still occurs.",
    });
    await api(root + "/issues/" + issue.number, "PATCH", { state: "closed", state_reason: "not_planned" });
    closed++;
  }
  return closed;
}
