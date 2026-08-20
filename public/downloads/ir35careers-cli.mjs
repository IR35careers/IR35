#!/usr/bin/env node

const baseUrl = (process.env.IR35CAREERS_BASE_URL || "https://www.ir35careers.com").replace(/\/$/, "");
const [command = "help", ...args] = process.argv.slice(2);

function help() {
  console.log(`IR35Careers read-only helper

Usage:
  node ir35careers-cli.mjs search "platform engineer"
  node ir35careers-cli.mjs analyse "https://example.com/job"

Optional:
  IR35CAREERS_BASE_URL=http://localhost:3000

This helper searches and analyses public listings. It never submits an application.`);
}

function printJob(job) {
  const rate = job.rate_min || job.rate_max
    ? `${job.rate_currency || "GBP"} ${job.rate_min || "?"}-${job.rate_max || "?"} ${job.rate_type || ""}`
    : "Rate not stated";
  console.log(`\n${job.title}\n${job.company_name} · ${job.location}\nIR35: ${job.ir35_status} · ${rate}\n${job.apply_url || `${baseUrl}/jobs/${job.id}`}`);
}

async function main() {
  if (command === "help" || command === "--help" || command === "-h") {
    help();
    return;
  }

  if (command === "search") {
    const query = args.join(" ").trim();
    if (!query) throw new Error("Add a role, skill or company after 'search'.");
    const url = new URL("/api/jobs/search", baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("per_page", "10");
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Search failed (${response.status}).`);
    console.log(`${payload.total} matching contract${payload.total === 1 ? "" : "s"}`);
    payload.jobs.forEach(printJob);
    return;
  }

  if (command === "analyse") {
    const sourceUrl = args[0];
    if (!sourceUrl) throw new Error("Add a public HTTPS job URL after 'analyse'.");
    const response = await fetch(new URL("/api/jobs/preview", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url: sourceUrl }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Analysis failed (${response.status}).`);
    printJob(payload.job);
    console.log(`Skills: ${payload.job.skills.join(", ") || "None extracted"}`);
    return;
  }

  throw new Error(`Unknown command '${command}'. Run with --help for usage.`);
}

main().catch((error) => {
  console.error(`IR35Careers: ${error instanceof Error ? error.message : "Unexpected error"}`);
  process.exitCode = 1;
});
