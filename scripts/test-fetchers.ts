/**
 * ATS fetcher test suite — no network required.
 *
 * Tests the pure mapping functions against realistic API response fixtures,
 * the HttpClient's retry/backoff behaviour via an injected fake fetch, and
 * an end-to-end fixture → mapper → processing-engine integration path.
 *
 * Run with:
 *   npx tsc scripts/test-fetchers.ts --outDir .test-build --module commonjs \
 *     --target es2020 --esModuleInterop --skipLibCheck --strict
 *   node .test-build/scripts/test-fetchers.js
 */

import { mapGreenhouseJob } from "../src/lib/ats/greenhouse-fetcher";
import { mapLeverJob } from "../src/lib/ats/lever-fetcher";
import { mapAshbyJob } from "../src/lib/ats/ashby-fetcher";
import { mapWorkableJob } from "../src/lib/ats/workable-fetcher";
import { HttpClient, HttpError } from "../src/lib/ats/http-client";
import { processRawJob } from "../src/lib/processing/job-processor";
import type { CompanyConfig } from "../src/lib/ats/types";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else {
    failed++;
    console.error(`✗ ${name}\n    expected: ${e}\n    actual:   ${a}`);
  }
}
function checkTrue(name: string, condition: boolean) {
  if (condition) passed++;
  else {
    failed++;
    console.error(`✗ ${name} — condition was false`);
  }
}

const company: CompanyConfig = { name: "Acme Ltd", type: "greenhouse", slug: "acme" };

// ── Greenhouse mapper ────────────────────────────────────────────────────────
{
  const fixture = {
    id: 4567890,
    title: "Senior Platform Engineer (Outside IR35)",
    updated_at: "2026-07-10T12:00:00Z",
    first_published: "2026-07-01T09:00:00Z",
    absolute_url: "https://boards.greenhouse.io/acme/jobs/4567890",
    location: { name: "London, England" },
    content:
      "&lt;p&gt;6 month contract at &lt;strong&gt;£600 per day&lt;/strong&gt;, outside IR35. Kubernetes &amp;amp; Terraform.&lt;/p&gt;",
  };
  const raw = mapGreenhouseJob(fixture, company);
  check("gh: dedup key", [raw.sourceDomain, raw.sourceIdentifier], ["boards.greenhouse.io", "4567890"]);
  check("gh: title/company", [raw.title, raw.companyName], [fixture.title, "Acme Ltd"]);
  check("gh: location", raw.location, "London, England");
  check("gh: postedAt prefers first_published", raw.postedAt, "2026-07-01T09:00:00Z");
  check("gh: apply url", raw.applyUrl, fixture.absolute_url);

  // End-to-end: double-encoded content must survive processing.
  const processed = processRawJob(raw);
  checkTrue("gh e2e: accepted as UK contract", processed !== null);
  if (processed) {
    checkTrue("gh e2e: double-encoded HTML stripped", !processed.description.includes("&lt;") && !processed.description.includes("<p>"));
    check("gh e2e: rate parsed from description", [processed.rate_min, processed.rate_type], [600, "daily"]);
    check("gh e2e: ir35 from title", processed.ir35_status, "outside");
    checkTrue("gh e2e: skills", processed.skills.includes("Kubernetes") && processed.skills.includes("Terraform"));
    check("gh e2e: location canonical", processed.location, "London");
  }
}

// ── Lever mapper ─────────────────────────────────────────────────────────────
{
  const fixture = {
    id: "a1b2c3d4-0000-1111-2222-333344445555",
    text: "Contract Data Engineer",
    hostedUrl: "https://jobs.lever.co/acme/a1b2c3d4",
    createdAt: 1752300000000,
    country: "GB",
    workplaceType: "hybrid",
    categories: { location: "Manchester", commitment: "Contract" },
    descriptionPlain: "Inside IR35 engagement. Snowflake and dbt experience required.",
    additionalPlain: "3 days per week in the office.",
    lists: [{ text: "Requirements", content: "Python, Airflow" }],
    salaryRange: { min: 450, max: 550, currency: "GBP", interval: "per-day" },
  };
  const raw = mapLeverJob(fixture, company);
  check("lever: dedup key", [raw.sourceDomain, raw.sourceIdentifier], ["jobs.lever.co", fixture.id]);
  check("lever: salary string", raw.rawSalary, "GBP 450-550 per-day");
  checkTrue("lever: commitment surfaced in description", raw.description.includes("Commitment: Contract"));
  checkTrue("lever: location includes workplace type", raw.location.includes("hybrid"));
  check("lever: postedAt ISO", raw.postedAt, new Date(1752300000000).toISOString());

  const processed = processRawJob(raw);
  checkTrue("lever e2e: accepted", processed !== null);
  if (processed) {
    check("lever e2e: structured rate parsed", [processed.rate_min, processed.rate_max, processed.rate_currency, processed.rate_type], [450, 550, "GBP", "daily"]);
    check("lever e2e: ir35 inside from description", processed.ir35_status, "inside");
    check("lever e2e: hybrid detected", processed.remote_type, "hybrid");
    checkTrue("lever e2e: skills", ["Snowflake", "dbt", "Python", "Airflow"].every((s) => processed.skills.includes(s)));
  }
}

// ── Ashby mapper ─────────────────────────────────────────────────────────────
{
  const fixture = {
    id: "9f8e7d6c",
    title: "Freelance Motion Designer",
    location: "London",
    isRemote: true,
    isListed: true,
    employmentType: "Contract",
    publishedAt: "2026-07-12T08:00:00Z",
    jobUrl: "https://jobs.ashbyhq.com/acme/9f8e7d6c",
    descriptionPlain: "Day rate £350, fully remote within the UK. Figma essential.",
    compensation: { compensationTierSummary: "£350 per day" },
  };
  const raw = mapAshbyJob(fixture, company);
  check("ashby: dedup key", [raw.sourceDomain, raw.sourceIdentifier], ["jobs.ashbyhq.com", "9f8e7d6c"]);
  check("ashby: rawSalary from compensation", raw.rawSalary, "£350 per day");
  checkTrue("ashby: employment type surfaced", raw.description.includes("Employment type: Contract"));
  checkTrue("ashby: remote suffix on location", raw.location.includes("Remote"));

  const processed = processRawJob(raw);
  checkTrue("ashby e2e: accepted", processed !== null);
  if (processed) {
    check("ashby e2e: rate", [processed.rate_min, processed.rate_type], [350, "daily"]);
    check("ashby e2e: remote", processed.remote_type, "remote");
    checkTrue("ashby e2e: Figma skill", processed.skills.includes("Figma"));
  }
}

// ── Workable mapper ──────────────────────────────────────────────────────────
{
  const fixture = {
    title: "Interim Finance Systems Consultant",
    shortcode: "AB12CD",
    url: "https://apply.workable.com/acme/j/AB12CD/",
    employment_type: "Contract",
    telecommuting: false,
    city: "Leeds",
    country: "United Kingdom",
    published_on: "2026-07-14",
    description: "<p>6-month contract. SAP experience. Office based in Leeds. £500 p/d outside IR35.</p>",
  };
  const raw = mapWorkableJob(fixture, company);
  check("workable: dedup key", [raw.sourceDomain, raw.sourceIdentifier], ["apply.workable.com", "AB12CD"]);
  check("workable: location join", raw.location, "Leeds, United Kingdom");
  checkTrue("workable: employment surfaced", raw.description.includes("Employment type: Contract"));

  const processed = processRawJob(raw);
  checkTrue("workable e2e: accepted", processed !== null);
  if (processed) {
    check("workable e2e: rate", [processed.rate_min, processed.rate_type], [500, "daily"]);
    check("workable e2e: ir35", processed.ir35_status, "outside");
    check("workable e2e: location canonical", processed.location, "Leeds");
    check("workable e2e: onsite", processed.remote_type, "onsite");
  }
}

// ── HttpClient retry behaviour (injected fake fetch, tiny backoffs) ─────────
{
  (async () => {
    // Succeeds on the 3rd attempt after two 500s.
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls < 3) return new Response("err", { status: 500 });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new HttpClient({ minDelayMs: 1, baseBackoffMs: 1, maxRetries: 3, fetchImpl: flaky });
    const result = await client.getJson<{ ok: boolean }>("https://example.com/x");
    check("http: retries then succeeds", [calls, result.ok], [3, true]);

    // 404 fails fast: exactly one call, no retries.
    let calls404 = 0;
    const notFound = (async () => {
      calls404++;
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const client404 = new HttpClient({ minDelayMs: 1, baseBackoffMs: 1, maxRetries: 3, fetchImpl: notFound });
    let threw = false;
    try {
      await client404.getJson("https://example.com/missing");
    } catch (err) {
      threw = err instanceof HttpError && err.status === 404;
    }
    check("http: 404 fails fast without retries", [calls404, threw], [1, true]);

    // 429 IS retried.
    let calls429 = 0;
    const rateLimited = (async () => {
      calls429++;
      if (calls429 === 1) return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    const client429 = new HttpClient({ minDelayMs: 1, baseBackoffMs: 1, maxRetries: 2, fetchImpl: rateLimited });
    await client429.getJson("https://example.com/limited");
    check("http: 429 is retried", calls429, 2);

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })().catch((e) => {
    console.error("async test crash:", e);
    process.exit(1);
  });
}
