import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JobDescriptionDisclosure, JobDescriptionText } from "@/components/JobDescription";
import { isTruncatedJobDescription, jobDescriptionKind, jobDescriptionSourceUrl, limitImportedJobDescription } from "@/lib/job-description";
import { parseExternalJobHtml } from "@/lib/job-preview";
import { buildJobPosting } from "@/lib/job-seo";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { findRateInText } from "@/lib/processing/rate-parser";

const original = "https://careers.example.test/contracts/1";
const html = (description?: string) => `<script type="application/ld+json">${JSON.stringify({
  "@type": "JobPosting", title: "Platform contractor", description, hiringOrganization: { name: "Fictional test company" },
  datePosted: "2026-10-01", jobLocation: { address: { addressLocality: "London" } },
})}</script>`;

describe("complete and truthful job description display", () => {
  it("renders every supplied character, including the tail after a very long token, as escaped plain text", () => {
    const description = `First paragraph.\n\n${"A".repeat(1500)}\nFinal paragraph marker. <script>not executable</script>`;
    const markup = renderToStaticMarkup(createElement(JobDescriptionText, { description, sourceUrl: original }));
    expect(markup).toContain("A".repeat(1500)); expect(markup).toContain("Final paragraph marker.");
    expect(markup).toContain("&lt;script&gt;not executable&lt;/script&gt;"); expect(markup).not.toContain("<script>");
    expect(markup).toContain("overflow-wrap:anywhere"); expect(markup).not.toMatch(/line-clamp|max-h-|overflow-y-auto/);
    expect(markup).not.toContain("shown in full"); expect(markup).not.toContain("Full contract description");
  });
  it("provides a native initially-open disclosure without relying on JavaScript", () => {
    const markup = renderToStaticMarkup(createElement(JobDescriptionDisclosure, { description: "Tail marker." }));
    expect(markup).toMatch(/<details[^>]*open=""/); expect(markup).toContain("<summary");
    expect(markup).toContain("Contract description"); expect(markup).toContain("Tail marker.");
    expect(renderToStaticMarkup(createElement(JobDescriptionDisclosure, { description: "Tail.", open: false }))).not.toContain('open=""');
  });
  it.each(["Summary cut off…", "Summary cut off...\n", "Summary."])("labels a known source summary without pretending to reconstruct it: %s", description => {
    expect(jobDescriptionKind(description, "summary")).toBe("summary");
    const markup = renderToStaticMarkup(createElement(JobDescriptionText, { description, kind: "summary", sourceUrl: original }));
    expect(markup).toContain("not a confirmed full advert"); expect(markup).toContain(`href="${original}"`);
    expect(markup).toContain('rel="noopener noreferrer"');
  });
  it.each(["", "   ", "The source did not expose a readable job description. Review the original page before acting.", "Full details are on the original listing."])("shows an honest missing-source message for %s", description => {
    expect(jobDescriptionKind(description)).toBe("missing");
    const markup = renderToStaticMarkup(createElement(JobDescriptionText, { description }));
    expect(markup).toContain("did not provide readable description text");
    expect(markup).toContain("original posting link is not available");
  });
  it("does not infer incompleteness only from short text or claim that non-ellipsis proves a full advert", () => {
    expect(jobDescriptionKind("Six month contract.")).toBe("source_text");
    expect(isTruncatedJobDescription("A complete sentence.")).toBe(false);
    expect(isTruncatedJobDescription("A snippet... ")).toBe(true);
    expect(jobDescriptionKind("A snippet…", "source_text")).toBe("summary");
    expect(jobDescriptionKind("", "limited")).toBe("limited");
  });
  it.each(["javascript:alert(1)", "data:text/html,bad", "https://user:password@example.test/job", "/jobs/1", "not a URL"])("never renders an unsafe/inapplicable original href %s", sourceUrl => {
    expect(jobDescriptionSourceUrl(sourceUrl)).toBeNull();
    const markup = renderToStaticMarkup(createElement(JobDescriptionText, { description: "A summary…", sourceUrl }));
    expect(markup).not.toContain("href=");
  });
});

describe("word-safe import bounds and known source provenance", () => {
  it("does not change text below or exactly at the safety cap", () => {
    expect(limitImportedJobDescription("Full supplied text.")).toEqual({ text: "Full supplied text.", limited: false });
    expect(limitImportedJobDescription("1234567890", 10)).toEqual({ text: "1234567890", limited: false });
  });
  it("cuts only at a complete word and retains the hard cap, including its ellipsis", () => {
    expect(limitImportedJobDescription("One two supercalifragilistic", 10)).toEqual({ text: "One two…", limited: true });
    expect(limitImportedJobDescription("One two three four", 8)).toEqual({ text: "One two…", limited: true });
    expect(limitImportedJobDescription("One two\nthree four", 8)).toEqual({ text: "One two…", limited: true });
    const result = limitImportedJobDescription(`${"Complete sentence. ".repeat(6000)}Tail marker.`);
    expect(result.limited).toBe(true); expect(result.text.length).toBeLessThanOrEqual(100_000);
    expect(result.text).toMatch(/(?:sentence\.|Complete)…$/); expect(result.text).not.toMatch(/senten…$/);
  });
  it("does not return a half token or split surrogate pair when no complete word fits", () => {
    expect(limitImportedJobDescription("A".repeat(11), 10)).toEqual({ text: "", limited: true });
    expect(limitImportedJobDescription("😀".repeat(10), 9)).toEqual({ text: "", limited: true });
  });
  it.each([0, 1, 100001, Infinity, 3.5])("rejects a bad safety cap %s", maximum => {
    expect(() => limitImportedJobDescription("text", maximum)).toThrow("Invalid job description limit");
  });
  it("marks meta-description fallback as summary even if it ends in a full stop", () => {
    const job = parseExternalJobHtml(`${html()}<meta name="description" content="A short search excerpt.">`, original, DEMO_JOBS[0].id);
    expect(job.description).toBe("A short search excerpt."); expect(job.description_kind).toBe("summary");
    expect(buildJobPosting(job)).toBeNull();
  });
  it("does not put missing-description UI copy into the job facts", () => {
    const job = parseExternalJobHtml(html(), original, DEMO_JOBS[0].id);
    expect(job.description).toBe(""); expect(job.description_kind).toBe("missing");
    expect(buildJobPosting(job)).toBeNull();
  });
  it("keeps the full structured text or marks a word-safe limited import and withholds markup", () => {
    const full = "First paragraph.\n\nFinal paragraph from the actual source.";
    const job = parseExternalJobHtml(html(full), original, DEMO_JOBS[0].id);
    expect(job.description).toContain("Final paragraph from the actual source."); expect(job.description_kind).toBe("source_text");
    expect(buildJobPosting(job)).not.toBeNull();
    const limited = parseExternalJobHtml(html(`${"Word ".repeat(20000)}oversizedtoken`), original, DEMO_JOBS[0].id);
    expect(limited.description_kind).toBe("limited"); expect(limited.description.length).toBeLessThanOrEqual(100_000);
    expect(limited.description.endsWith("…")).toBe(true); expect(buildJobPosting(limited)).toBeNull();
  });
  it("handles maximum-size paragraphs with no rate or no pay period without quadratic rescanning", () => {
    expect(findRateInText("Word ".repeat(20000))).toMatchObject({ min: null, max: null });
    expect(findRateInText(`${"Word ".repeat(19998)}£200`)).toMatchObject({ min: null, max: null });
    expect(findRateInText("Intro. Six month contract: £35.98/hour. More details.")).toMatchObject({ min: 35.98, max: 35.98, type: "hourly" });
    expect(findRateInText("Intro\nPay £600-£650 per day\nNext paragraph")).toMatchObject({ min: 600, max: 650, type: "daily" });
  });
});
