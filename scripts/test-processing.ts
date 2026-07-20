/**
 * Processing engine test suite.
 *
 * No test framework needed. Run with:
 *   npx tsc scripts/test-processing.ts --outDir .test-build --module commonjs \
 *     --target es2020 --esModuleInterop --skipLibCheck --strict
 *   node .test-build/scripts/test-processing.js
 *
 * Exits non-zero on any failure.
 */

import { parseRate, findRateInText } from "../src/lib/processing/rate-parser";
import { classifyIR35 } from "../src/lib/processing/ir35-classifier";
import { extractSkills } from "../src/lib/processing/skills-extractor";
import { normalizeLocation, detectRemoteType } from "../src/lib/processing/location-normalizer";
import { findFuzzyDuplicate, jobSimilarity } from "../src/lib/processing/deduplicator";
import { processRawJob, stripHtml, cleanTitle, isContractRole, isProfessionalRole } from "../src/lib/processing/job-processor";
import type { RawATSJob } from "../src/lib/ats/types";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
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

// ── Rate parser ──────────────────────────────────────────────────────────────
{
  const r1 = parseRate("£550/day");
  check("rate: £550/day", [r1.min, r1.max, r1.currency, r1.type], [550, 550, "GBP", "daily"]);

  const r2 = parseRate("£550 - £650 per day");
  check("rate: £550 - £650 per day", [r2.min, r2.max, r2.type, r2.confidence], [550, 650, "daily", "high"]);

  const r3 = parseRate("£550-650 pd");
  check("rate: £550-650 pd", [r3.min, r3.max, r3.type], [550, 650, "daily"]);

  const r4 = parseRate("Up to £700 per day");
  check("rate: up to £700", [r4.min, r4.max, r4.confidence], [null, 700, "medium"]);

  const r5 = parseRate("From £400/day");
  check("rate: from £400", [r5.min, r5.max], [400, null]);

  const r6 = parseRate("circa £600/day");
  check("rate: circa £600", [r6.min, r6.max], [540, 660]);

  const r7 = parseRate("$60/hr");
  check("rate: $60/hr", [r7.min, r7.currency, r7.type], [60, "USD", "hourly"]);

  const r8 = parseRate("Competitive");
  check("rate: competitive", [r8.min, r8.max, r8.type, r8.confidence], [null, null, "unknown", "low"]);

  const r9 = parseRate("£85k per annum");
  check("rate: £85k pa", [r9.min, r9.type], [85000, "annual"]);

  const r10 = parseRate("£1,200 per day");
  check("rate: £1,200/day (comma)", [r10.min, r10.type], [1200, "daily"]);

  const r11 = parseRate("600 per day");
  check("rate: bare 600/day → GBP assumed", [r11.min, r11.currency, r11.type], [600, "GBP", "daily"]);

  const r12 = parseRate("");
  check("rate: empty", [r12.min, r12.max], [null, null]);

  const inText = findRateInText(
    "We are looking for an engineer. The day rate is £575 per day outside IR35. Apply now."
  );
  check("rate from description", [inText.min, inText.type], [575, "daily"]);

  const noRate = findRateInText("Great role with excellent benefits and 25 days holiday.");
  check("no false rate from '25 days holiday'", [noRate.min, noRate.max], [null, null]);
}

// ── IR35 classifier ──────────────────────────────────────────────────────────
{
  check(
    "ir35: outside in title",
    classifyIR35("Senior React Developer - Outside IR35", "desc"),
    { status: "outside", confidence: "high" }
  );
  check(
    "ir35: inside in title",
    classifyIR35("PM (Inside IR35)", "desc"),
    { status: "inside", confidence: "high" }
  );
  check(
    "ir35: outside in description only",
    classifyIR35("Senior React Developer", "This role has been deemed outside IR35."),
    { status: "outside", confidence: "medium" }
  );
  check(
    "ir35: 'IR35: Outside' variant",
    classifyIR35("Data Engineer", "IR35 Status: Outside. 6 month contract."),
    { status: "outside", confidence: "medium" }
  );
  check(
    "ir35: no mention → unknown",
    classifyIR35("Software Engineer", "A great contract role."),
    { status: "unknown", confidence: "low" }
  );
  check(
    "ir35: both mentioned → unknown",
    classifyIR35("Engineer", "Available inside IR35 or outside IR35 depending on determination."),
    { status: "unknown", confidence: "low" }
  );
  check(
    "ir35: umbrella only → inside (medium)",
    classifyIR35("Contract Analyst", "This role is via umbrella company only."),
    { status: "inside", confidence: "medium" }
  );
  check(
    "ir35: ir-35 hyphen variant",
    classifyIR35("DevOps Engineer outside IR-35", ""),
    { status: "outside", confidence: "high" }
  );
}

// ── Skills extractor ─────────────────────────────────────────────────────────
{
  const s1 = extractSkills(
    "Senior React Developer",
    "You will use TypeScript, Node.js and AWS. Experience with Kubernetes and Terraform desired."
  );
  checkTrue(
    "skills: finds React/TypeScript/Node.js/AWS/Kubernetes/Terraform",
    ["React", "TypeScript", "Node.js", "AWS", "Kubernetes", "Terraform"].every((s) => s1.includes(s))
  );

  const s2 = extractSkills("Java Developer", "Strong Java and Spring Boot experience.");
  checkTrue("skills: Java without JavaScript false-positive", s2.includes("Java") && !s2.includes("JavaScript"));

  const s3 = extractSkills("Backend engineer", "We use Go and Rust in production.");
  checkTrue("skills: capitalized Go matches", s3.includes("Go"));

  const s4 = extractSkills("Analyst", "you must go to the office twice a week.");
  checkTrue("skills: lowercase 'go' does not match Go", !s4.includes("Go"));

  const s5 = extractSkills("Platform Engineer", "CI/CD pipelines with GitHub Actions. SC cleared required.");
  checkTrue("skills: CI/CD + GitHub Actions + SC Cleared", s5.includes("CI/CD") && s5.includes("GitHub Actions") && s5.includes("SC Cleared"));

  const s6 = extractSkills("React Native Developer", "Build mobile apps with React Native.");
  checkTrue("skills: React Native distinct from React", s6.includes("React Native"));
}

// ── Location normalizer ──────────────────────────────────────────────────────
{
  check("loc: London (City)", normalizeLocation("London (City)"), { location: "London", isUK: true });
  check("loc: Greater London", normalizeLocation("Greater London"), { location: "London", isUK: true });
  check("loc: Manchester, England, United Kingdom", normalizeLocation("Manchester, England, United Kingdom"), {
    location: "Manchester",
    isUK: true,
  });
  check("loc: Remote - UK", normalizeLocation("Remote - UK"), { location: "Remote (UK)", isUK: true });
  check("loc: bare Remote → maybe-UK", normalizeLocation("Remote"), { location: "Remote", isUK: true });
  check("loc: Remote (USA)", normalizeLocation("Remote (USA)").isUK, false);
  check("loc: New York, NY", normalizeLocation("New York, NY").isUK, false);
  check("loc: Berlin", normalizeLocation("Berlin, Germany").isUK, false);

  check("remote: fully remote", detectRemoteType("Remote (UK)", "This is a fully remote role."), "remote");
  check("remote: hybrid beats remote mention", detectRemoteType("London", "Remote working available, 2 days in the office per week."), "hybrid");
  check("remote: office based", detectRemoteType("Leeds", "This role is office based."), "onsite");
  check("remote: nothing stated", detectRemoteType("Bristol", "Great engineering role."), "unknown");
}

// ── Deduplicator ─────────────────────────────────────────────────────────────
{
  const a = { title: "Senior React Developer", company_name: "Acme Ltd", rate_min: 550, rate_max: 650, location: "London" };
  const b = { title: "Senior React Developer - 6 Month Contract", company_name: "Acme Ltd", rate_min: 550, rate_max: 650, location: "London" };
  const c = { title: "Junior PHP Developer", company_name: "Other Corp", rate_min: 300, rate_max: 350, location: "Leeds" };

  checkTrue("dedup: near-identical scores high", jobSimilarity(a, b) >= 0.9);
  checkTrue("dedup: different jobs score low", jobSimilarity(a, c) < 0.6);
  checkTrue("dedup: finds the duplicate", findFuzzyDuplicate(a, [c, b]) === b);
  checkTrue("dedup: no false duplicate", findFuzzyDuplicate(a, [c]) === null);

  const exact = { ...a };
  checkTrue("dedup: identical = 1.0", Math.abs(jobSimilarity(a, exact) - 1) < 1e-9);
}

// ── Job processor (end-to-end) ───────────────────────────────────────────────
{
  check(
    "stripHtml basic",
    stripHtml("<p>Hello <strong>world</strong></p><ul><li>One</li></ul>"),
    "Hello world \n One"
  );
  check("cleanTitle strips URGENT", cleanTitle("URGENT: React Developer"), "React Developer");
  checkTrue("isContractRole: day rate in desc", isContractRole("React Dev", "£550 per day contract role", ""));
  checkTrue("isContractRole: title says Contract", isContractRole("Contract React Developer", "Great opportunity.", ""));
  checkTrue("isContractRole: title says Outside IR35", isContractRole("Dev (Outside IR35)", "Some desc.", ""));
  checkTrue("isContractRole: title says Interim", isContractRole("Interim CTO", "Join our team.", ""));
  checkTrue("isContractRole: 6 month contract in desc", isContractRole("React Dev", "This is a 6 month contract engagement in London.", ""));
  checkTrue("isContractRole: employment type Contract", isContractRole("React Dev", "Employment type: Contract. Build features.", ""));
  checkTrue("isContractRole: freelance in title", isContractRole("Freelance Designer", "Design websites.", ""));

  // These must NOT be detected as contract roles:
  checkTrue("isContractRole: permanent salaried role rejected", !isContractRole("React Developer", "Permanent position with £65k salary and pension.", ""));
  checkTrue("isContractRole: bare 'contract' in legal boilerplate rejected", !isContractRole("Software Engineer", "Your employment contract includes health insurance and 25 days annual leave.", ""));
  checkTrue("isContractRole: 'permanent contract' rejected", !isContractRole("Data Analyst", "This is a permanent contract with competitive salary.", ""));
  checkTrue("isContractRole: no signals at all rejected", !isContractRole("Product Manager", "Lead a team of engineers. Competitive salary and benefits.", ""));
  checkTrue("isContractRole: 'terms of the contract' rejected", !isContractRole("Backend Engineer", "You will agree to the terms of the contract upon joining. Full time role.", ""));

  const raw: RawATSJob = {
    sourceDomain: "boards.greenhouse.io",
    sourceIdentifier: "12345",
    sourceType: "greenhouse",
    title: "URGENT - Senior React Developer (Outside IR35)",
    companyName: "Acme Ltd",
    description:
      "<p>6 month contract, <strong>£550-£650 per day</strong>, outside IR35.</p><p>Fully remote within the UK. You will use React, TypeScript and AWS.</p>",
    location: "Remote - UK",
    rawSalary: "£550 - £650 per day",
    applyUrl: "https://example.com/apply/12345",
    postedAt: "2026-07-15T09:00:00Z",
    rawPayload: { id: 12345 },
  };

  const processed = processRawJob(raw);
  checkTrue("processor: accepts a valid UK contract job", processed !== null);
  if (processed) {
    check("processor: title cleaned", processed.title, "Senior React Developer (Outside IR35)");
    check("processor: ir35", [processed.ir35_status, processed.ir35_confidence], ["outside", "high"]);
    check("processor: rate", [processed.rate_min, processed.rate_max, processed.rate_type], [550, 650, "daily"]);
    check("processor: location", processed.location, "Remote (UK)");
    check("processor: remote type", processed.remote_type, "remote");
    checkTrue("processor: skills found", ["React", "TypeScript", "AWS"].every((s) => processed.skills.includes(s)));
    check("processor: dedup key preserved", [processed.source_domain, processed.source_identifier], ["boards.greenhouse.io", "12345"]);
  }

  // Non-UK job must be dropped.
  const usJob: RawATSJob = { ...raw, location: "New York, NY", rawSalary: "$800 per day", description: "Contract role, $800/day." , title: "Senior React Developer (Contract)"};
  check("processor: drops non-UK job", processRawJob(usJob), null);

  // Permanent job must be dropped.
  const permJob: RawATSJob = {
    ...raw,
    title: "Senior React Developer",
    description: "Permanent position. £70k salary, pension, 25 days holiday.",
    rawSalary: "£70,000",
    location: "London",
  };
  check("processor: drops permanent job", processRawJob(permJob), null);

  // Bare "Remote" with no UK signal must be dropped; with GBP rate it stays.
  const bareRemoteNoSignal: RawATSJob = {
    ...raw,
    title: "Contract Designer",
    description: "Freelance contract role. Fully remote.",
    rawSalary: "",
    location: "Remote",
  };
  check("processor: bare Remote without UK signal dropped", processRawJob(bareRemoteNoSignal), null);

  const bareRemoteGBP: RawATSJob = { ...bareRemoteNoSignal, rawSalary: "£400 per day" };
  checkTrue("processor: bare Remote + GBP rate accepted", processRawJob(bareRemoteGBP) !== null);
}


// ── Zero-rate + professional gates ───────────────────────────────────────────
{
  const zero = parseRate("£0");
  check("rate: £0 means unspecified", [zero.min, zero.max], [null, null]);
  const zeroRange = parseRate("£0 - £0 per day");
  check("rate: £0-£0 range means unspecified", [zeroRange.min, zeroRange.max], [null, null]);

  checkTrue("professional: retail colleague rejected", !isProfessionalRole("Service Colleague", parseRate("£13 per hour")));
  checkTrue("professional: warehouse operative rejected", !isProfessionalRole("Warehouse Operative - 6 month contract", parseRate("")));
  checkTrue("professional: care assistant rejected", !isProfessionalRole("Care Assistant", parseRate("")));
  checkTrue("professional: low hourly rejected", !isProfessionalRole("Data Entry Clerk", parseRate("£12 per hour")));
  checkTrue("professional: low daily rejected", !isProfessionalRole("Admin Temp", parseRate("£90 per day")));
  checkTrue("professional: recruitment admin support rejected", !isProfessionalRole("Recruitment Administration Support Assistant", parseRate("£35000 per annum")));
  checkTrue("professional: admin assistant rejected", !isProfessionalRole("Administrative Assistant", parseRate("")));
  checkTrue("professional: teaching assistant rejected", !isProfessionalRole("Autism SEN Teaching Assistant", parseRate("")));
  checkTrue("professional: receptionist rejected", !isProfessionalRole("Receptionist", parseRate("")));
  checkTrue("professional: low annual salary rejected", !isProfessionalRole("Junior Analyst", parseRate("£28000 per annum")));
  checkTrue("professional: high day-rate contractor kept", isProfessionalRole("Senior React Developer", parseRate("£550 per day")));
  checkTrue("professional: unknown rate kept", isProfessionalRole("DevOps Engineer", parseRate("")));
  checkTrue("professional: chef title in Chief not matched", isProfessionalRole("Chief Technology Officer (Interim)", parseRate("£900 per day")));
  checkTrue("ir35: outside scope → outside", classifyIR35("Consultant", "This engagement is outside the scope of IR35.").status === "outside");
  checkTrue("ir35: IR35 applies → inside", classifyIR35("Analyst", "Please note IR35 applies to this role.").status === "inside");
  checkTrue("ir35: caught by IR35 → inside", classifyIR35("Developer", "This role is caught by IR35.").status === "inside");
  checkTrue("ir35: not caught by IR35 → outside", classifyIR35("Developer", "This role is not caught by IR35.").status === "outside");
  checkTrue("ir35: SDS Outside → outside", classifyIR35("Engineer", "Status Determination Statement: Outside.").status === "outside");
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
