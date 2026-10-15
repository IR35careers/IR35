import { describe, expect, it, vi } from "vitest";
import { buildJobPosting, jobMetadata } from "@/lib/job-seo";
import { publicPageMetadata, searchTitle, structuredDataJson } from "@/lib/seo";
import { allSeoSlugs, getSeoPage } from "@/lib/seo-pages";
import { BLOG_POSTS } from "@/lib/blog-posts";
import { planJobQuality, type QualityJob } from "@/lib/processing/job-quality";
import { extractSkills } from "@/lib/processing/skills-extractor";
import { findFuzzyDuplicate } from "@/lib/processing/deduplicator";
import { findRateInText, parseRate } from "@/lib/processing/rate-parser";
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
import { matchesSeoFilters, isRelevantPublicJob } from "@/lib/public-job-inventory";

const job: QualityJob = {
  id: "01912345-1234-4123-8123-123456789012", title: "SAP Developer", company_name: "Example Consulting",
  location: "London", remote_type: "hybrid", ir35_status: "outside", ir35_confidence: "high",
  rate_min: 500, rate_max: 650, rate_currency: "GBP", rate_type: "daily", skills: ["SAP"],
  posted_at: "2026-10-01T09:00:00Z", first_seen_at: "2026-10-02T09:00:00Z",
  description: "Build SAP integrations for a UK enterprise client. Six month contract with a dedicated engineering team and delivery milestones.",
  apply_url: "https://example.org/job/123", source_domain: "example.org",
};

describe("public SEO", () => {
  it("gives every category and blog a bounded, non-duplicated search title", () => {
    for (const title of [...allSeoSlugs().map(slug => getSeoPage(slug)!.metaTitle), ...BLOG_POSTS.map(post => post.seoTitle)]) {
      expect(searchTitle(title).length).toBeLessThanOrEqual(60);
      expect(searchTitle(title).split("IR35Careers").length).toBeLessThanOrEqual(2);
    }
  });
  it("sets route-specific canonical and social metadata", () => {
    const meta = publicPageMetadata("/tools/take-home", "Contractor Take-Home Pay Calculator UK", "Compare contractor take-home pay.");
    expect(meta.alternates?.canonical).toBe("https://www.ir35careers.com/tools/take-home");
    expect(meta.title).toHaveProperty("absolute");
    expect(meta.openGraph).toHaveProperty("images");
  });
  it("uses advertiser and role facts in descriptions, even with no advertised rate", () => {
    const a = jobMetadata({ ...job, rate_min: null, rate_max: null });
    const b = jobMetadata({ ...job, title: "Python Engineer", company_name: "Another Client", rate_min: null, rate_max: null });
    expect(a.description).not.toBe(b.description);
    expect(a.description).toContain("Rate not stated");
    expect(a.description).toContain("SAP Developer at Example Consulting");
  });
  it("cannot close a JSON-LD script with untrusted listing text", () => {
    const value = { description: "</script><script>alert(1)</script>\u2028" };
    expect(structuredDataJson(value)).not.toContain("<");
    expect(JSON.parse(structuredDataJson(value))).toEqual(value);
  });
});

describe("truthful JobPosting markup", () => {
  it("describes a real contract with its full title, date, employer, location and advertised pay", () => {
    expect(buildJobPosting(job)).toMatchObject({ "@type": "JobPosting", title: job.title, datePosted: "2026-10-01T09:00:00.000Z", employmentType: "CONTRACTOR", hiringOrganization: { name: job.company_name },
      jobLocation: { address: { addressLocality: "London", addressCountry: "GB" } },
      baseSalary: { currency: "GBP", value: { minValue: 500, maxValue: 650, unitText: "DAY" } } });
  });
  it("does not invent salary, expiry, a direct-apply guarantee or an employer logo", () => {
    const schema = buildJobPosting({ ...job, rate_min: null, rate_max: null });
    for (const key of ["baseSalary", "validThrough", "directApply", "logo"]) expect(schema).not.toHaveProperty(key);
  });
  it("requires the original posting date rather than relabelling discovery time", () => {
    expect(buildJobPosting({ ...job, posted_at: null })).toBeNull();
    expect(buildJobPosting({ ...job, posted_at: "invalid" })).toBeNull();
  });
  it("does not advertise demo jobs to Google", () => {
    expect(buildJobPosting({ ...job, source_domain: "demo.ir35careers.local" })).toBeNull();
  });
  it("withholds Google Jobs markup when a provider supplied a truncated search summary", () => {
    expect(buildJobPosting({ ...job, description: "Build integrations and support products fro…" })).toBeNull();
    expect(buildJobPosting({ ...job, description: "Truncated description..." })).toBeNull();
  });
  it("marks fully remote UK jobs differently from hybrid jobs", () => {
    const remote = buildJobPosting({ ...job, remote_type: "remote" });
    expect(remote).toMatchObject({ jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { name: "United Kingdom" } });
    expect(remote).not.toHaveProperty("jobLocation");
    expect(buildJobPosting(job)).not.toHaveProperty("jobLocationType");
  });
  it("encodes HTML from advertiser text rather than allowing it to become markup", () => {
    expect(buildJobPosting({ ...job, description: "A < B\n\nSecond paragraph" })?.description).toBe("<p>A &lt; B</p><p>Second paragraph</p>");
  });
});

describe("category relevance and reversible feed repairs", () => {
  it.each(["Finance Manager", "Oracle HCM Solution Architect", "Product Data Administrator"])("does not promote incidental SAP mentions on %s", title => {
    const candidate = { ...job, title, description: "Knowledge of SAP is desirable." };
    expect(extractSkills(candidate.title, candidate.description)).not.toContain("SAP");
    expect(matchesSeoFilters(candidate, { skill: "SAP" })).toBe(false);
    expect(planJobQuality([candidate]).counts.sapTags).toBe(1);
  });
  it("keeps explicit SAP and ERP implementation roles", () => {
    expect(extractSkills("SAP Functional Consultant", "Implement finance systems.")).toContain("SAP");
    expect(extractSkills("ERP Integration Consultant", "Implement SAP integrations.")).toContain("SAP");
    expect(matchesSeoFilters(job, { skill: "SAP", location: "London", ir35: "outside" })).toBe(true);
    expect(matchesSeoFilters(job, { location: "Edinburgh" })).toBe(false);
  });
  it.each(["Early Years Practitioner", "PPA Teacher", "English Teacher", "Luxury Retail Sales", "FLT Driver"])("excludes %s without deleting its historical record", title => {
    const candidate = { ...job, title };
    expect(isRelevantPublicJob(candidate)).toBe(false);
    const plan = planJobQuality([candidate]);
    expect(plan.counts.offTopic).toBe(1);
    expect(plan.changes[0].after).toEqual({ expired_at: "REPAIR_TIME" });
    expect(plan.changes[0].before).toMatchObject({ expired_at: null, title });
  });
  it("detects an exact duplicate even when neither advertiser gives a rate", () => {
    const unknown = { ...job, rate_min: null, rate_max: null };
    expect(findFuzzyDuplicate(unknown, [{ ...unknown, id: "other" }])?.id).toBe("other");
    expect(planJobQuality([unknown, { ...unknown, id: "other" }]).counts.duplicates).toBe(1);
    expect(planJobQuality([job, { ...job, id: "other", description: "A different vacancy and different responsibilities." }]).counts.duplicates).toBe(0);
  });
  it("does not merge different titles or conflicting advertised pay", () => {
    expect(findFuzzyDuplicate(job, [{ ...job, title: "React Developer" }])).toBeNull();
    expect(findFuzzyDuplicate(job, [{ ...job, rate_min: 1000, rate_max: 1200 }])).toBeNull();
  });
  it("only backfills a precisely advertised rate, not missing or approximate pay", () => {
    const missing = { ...job, rate_min: null, rate_max: null, rate_type: "unknown" as const };
    expect(planJobQuality([{ ...missing, description: "Contract £550 per day. Build enterprise integrations." }]).counts.rates).toBe(1);
    expect(planJobQuality([{ ...missing, description: "circa £600 per day" }]).counts.rates).toBe(0);
    expect(planJobQuality([missing]).counts.rates).toBe(0);
  });
  it("recognises decimal hourly pay in descriptions and preserves advertised pennies", () => {
    expect(findRateInText("Design Engineer (Creo) £35.98 per hour (Umbrella) Inside IR35")).toMatchObject({ min: 35.98, max: 35.98, type: "hourly" });
    expect(parseRate("£35.98 per hour")).toMatchObject({ min: 35.98, max: 35.98 });
    expect(findRateInText("Rate: £45.50 - £48.75 per hour.")).toMatchObject({ min: 45.5, max: 48.75, type: "hourly" });
  });
  it("binds approval to an exact reproducible repair plan", () => {
    const a = { ...job, title: "English Teacher" };
    expect(planJobQuality([a]).planHash).toBe(planJobQuality([a]).planHash);
    expect(planJobQuality([a]).planHash).not.toBe(planJobQuality([job]).planHash);
  });
});
