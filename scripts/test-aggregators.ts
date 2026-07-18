/**
 * Aggregator fetcher test suite — no network required.
 *
 * Run with:
 *   npx tsc scripts/test-aggregators.ts --outDir .test-build --module commonjs \
 *     --target es2020 --esModuleInterop --skipLibCheck --strict
 *   node .test-build/scripts/test-aggregators.js
 */

import { mapReedJob, reedDateToIso, reedSalaryString } from "../src/lib/aggregators/reed-fetcher";
import { mapAdzunaJob } from "../src/lib/aggregators/adzuna-fetcher";
import { processRawJob } from "../src/lib/processing/job-processor";
import type { RawATSJob } from "../src/lib/ats/types";

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

// ── Reed date + salary helpers ───────────────────────────────────────────────
{
  check("reed date: DD/MM/YYYY → ISO", reedDateToIso("17/07/2026"), "2026-07-17T00:00:00Z");
  check("reed date: undefined → null", reedDateToIso(undefined), null);
  check("reed date: garbage → null", reedDateToIso("July 17th"), null);

  check("reed salary: range", reedSalaryString({ jobId: 1, minimumSalary: 450, maximumSalary: 550 }), "£450 - £550");
  check("reed salary: single", reedSalaryString({ jobId: 1, minimumSalary: 500, maximumSalary: 500 }), "£500");
  check("reed salary: none", reedSalaryString({ jobId: 1 }), "");
}

// ── Reed mapper + end-to-end ─────────────────────────────────────────────────
{
  const fixture = {
    jobId: 55501234,
    employerName: "Harvey Nash",
    jobTitle: "Senior Java Developer - Outside IR35",
    locationName: "London",
    minimumSalary: 550,
    maximumSalary: 650,
    currency: "GBP",
    date: "15/07/2026",
    jobDescription:
      "6 month contract for a Senior Java Developer. Outside IR35. Spring Boot, Kafka, AWS. Hybrid - 2 days per week in the office.",
    jobUrl: "https://www.reed.co.uk/jobs/senior-java-developer/55501234",
  };
  const raw = mapReedJob(fixture);
  check("reed: dedup key", [raw.sourceDomain, raw.sourceIdentifier], ["reed.co.uk", "55501234"]);
  check("reed: contractHint set", raw.contractHint, true);
  check("reed: salary string", raw.rawSalary, "£550 - £650");
  check("reed: posted ISO", raw.postedAt, "2026-07-15T00:00:00Z");

  const processed = processRawJob(raw);
  checkTrue("reed e2e: accepted", processed !== null);
  if (processed) {
    check("reed e2e: rate parsed with daily inference", [processed.rate_min, processed.rate_max, processed.rate_type], [550, 650, "daily"]);
    check("reed e2e: ir35 outside from title", [processed.ir35_status, processed.ir35_confidence], ["outside", "high"]);
    check("reed e2e: hybrid detected", processed.remote_type, "hybrid");
    checkTrue("reed e2e: skills", ["Java", "Spring Boot", "Kafka", "AWS"].every((s) => processed.skills.includes(s)));
    check("reed e2e: source type", processed.source_type, "reed");
  }
}

// ── contractHint behavior ────────────────────────────────────────────────────
{
  // A contract-hinted job with ZERO contract wording must still pass the gate
  // (the source's API-level filter is the authority).
  const noWording: RawATSJob = {
    sourceDomain: "reed.co.uk",
    sourceIdentifier: "1",
    sourceType: "reed",
    title: "Business Analyst",
    companyName: "Some Agency",
    description: "Banking client in Leeds. Requirements gathering and stakeholder workshops.",
    location: "Leeds",
    rawSalary: "£400 - £450",
    applyUrl: "https://example.com/1",
    postedAt: null,
    rawPayload: {},
    contractHint: true,
  };
  checkTrue("hint: contract-hinted job with no wording passes", processRawJob(noWording) !== null);

  // contractHint false must reject even with contract wording present.
  const hintedPerm: RawATSJob = { ...noWording, contractHint: false, description: "6 month contract role, day rate." };
  check("hint: contractHint false rejects", processRawJob(hintedPerm), null);

  // No hint → text heuristics still apply (no signals = rejected).
  const noHint: RawATSJob = { ...noWording, contractHint: undefined };
  check("hint: undefined falls back to heuristics (rejects no-signal job)", processRawJob(noHint), null);
}

// ── Adzuna mapper + end-to-end ───────────────────────────────────────────────
{
  const fixture = {
    id: 987654321,
    title: "Contract DevOps Engineer (Inside IR35)",
    description:
      "Inside IR35 via umbrella. £500 per day. Kubernetes, Terraform, Azure. Initial 6 month contract, fully remote within the UK.",
    redirect_url: "https://www.adzuna.co.uk/jobs/details/987654321",
    company: { display_name: "Hays Technology" },
    location: { display_name: "Manchester, Greater Manchester" },
    created: "2026-07-16T08:30:00Z",
    salary_min: 110000,
    salary_max: 130000,
    salary_is_predicted: "1",
  };
  const raw = mapAdzunaJob(fixture);
  check("adzuna: dedup key", [raw.sourceDomain, raw.sourceIdentifier], ["adzuna.com", "987654321"]);
  check("adzuna: contractHint set", raw.contractHint, true);
  check("adzuna: rawSalary deliberately empty (annualized/predicted)", raw.rawSalary, "");
  check("adzuna: posted passthrough", raw.postedAt, "2026-07-16T08:30:00Z");

  const processed = processRawJob(raw);
  checkTrue("adzuna e2e: accepted", processed !== null);
  if (processed) {
    check("adzuna e2e: rate found in description, not fake annual", [processed.rate_min, processed.rate_type], [500, "daily"]);
    check("adzuna e2e: ir35 inside from title", processed.ir35_status, "inside");
    check("adzuna e2e: location canonical", processed.location, "Manchester");
    check("adzuna e2e: remote detected", processed.remote_type, "remote");
    check("adzuna e2e: source type", processed.source_type, "adzuna");
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
