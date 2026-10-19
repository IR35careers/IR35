import { appendFile, readFile } from "node:fs/promises";
import { z } from "zod";
import { closeStale, reportChecks, selectPreview, syncIssue, syncPr, type Api } from "./github-loop";
import { REPOSITORY } from "./policy";

async function main() {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY || process.env.GITHUB_ACTIONS !== "true") throw new Error();
  const mode = z.enum(["sync-pr", "sync-issue", "report-checks", "stale", "select-preview"]).parse(process.argv[2]);
  const token = z.string().min(20).max(1024).parse(process.env.GITHUB_TOKEN);
  const eventPath = z.string().min(1).parse(process.env.GITHUB_EVENT_PATH);
  const bytes = await readFile(eventPath); if (bytes.length > 2_000_000) throw new Error();
  const event: unknown = JSON.parse(bytes.toString("utf8"));
  const api: Api = async (path, method = "GET", body) => {
    if (!path.startsWith("/repos/" + REPOSITORY + "/") || /[\r\n#]/.test(path)) throw new Error();
    const response = await fetch("https://api.github.com" + path, { method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error();
    if (response.status === 204) return null;
    if (!response.body) throw new Error();
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
        if (size > 4_000_000) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  };
  if (mode === "sync-pr") await syncPr(api, event);
  if (mode === "sync-issue") await syncIssue(api, event);
  if (mode === "report-checks") await reportChecks(api, event);
  if (mode === "stale") console.log("Bot triage issues closed: " + await closeStale(api, Date.now()));
  if (mode === "select-preview") {
    const selected = await selectPreview(api, event, { enabled: process.env.BOT_PREVIEW_ENABLED === "true", prefix: process.env.BOT_PREVIEW_PROJECT_PREFIX ?? "" });
    const output = selected ? "eligible=true\npreview_url=" + selected.url + "\npr=" + selected.number + "\nhead_sha=" + selected.sha + "\n" : "eligible=false\n";
    await appendFile(z.string().min(1).parse(process.env.GITHUB_OUTPUT), output, { encoding: "utf8" });
    console.log(selected ? "Selected the approved isolated preview for PR " + selected.number + "." : "No eligible isolated preview; no smoke/label approval.");
  }
}
main().catch(() => { console.error("Bot workflow stopped safely; inspect configuration and validated event. No private response or credential emitted."); process.exitCode = 1; });
