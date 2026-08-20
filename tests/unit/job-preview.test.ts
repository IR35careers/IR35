import { describe, expect, it } from "vitest";
import { parseExternalJobHtml } from "@/lib/job-preview";

describe("external job preview", () => {
  it("extracts structured role evidence without inventing IR35 status", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Senior React Contractor - Outside IR35",
      hiringOrganization: { "@type": "Organization", name: "Example Digital" },
      jobLocation: { address: { addressLocality: "Manchester", addressCountry: "GB" } },
      description: "<p>Six month contract using React, TypeScript and AWS. Outside IR35. Hybrid, 2 days in office.</p>",
      baseSalary: { currency: "GBP", value: { minValue: 600, maxValue: 700, unitText: "DAY" } },
      datePosted: "2026-08-20",
    })}</script></head></html>`;
    const job = parseExternalJobHtml(html, "https://jobs.example.com/react-contract", "11111111-1111-4111-8111-111111111111");
    expect(job.title).toContain("React Contractor");
    expect(job.company_name).toBe("Example Digital");
    expect(job.location).toBe("Manchester, GB");
    expect(job.ir35_status).toBe("outside");
    expect(job.ir35_confidence).toBe("high");
    expect(job.remote_type).toBe("hybrid");
    expect(job.rate_min).toBe(600);
    expect(job.rate_max).toBe(700);
    expect(job.rate_type).toBe("daily");
    expect(job.skills).toEqual(expect.arrayContaining(["React", "TypeScript", "AWS"]));
  });

  it("uses safe metadata fallbacks and leaves absent status unknown", () => {
    const html = `<html><head><title>Platform contractor</title><meta name="description" content="Help a delivery team improve cloud services."></head></html>`;
    const job = parseExternalJobHtml(html, "https://careers.example.org/role", "22222222-2222-4222-8222-222222222222");
    expect(job.company_name).toBe("careers.example.org");
    expect(job.ir35_status).toBe("unknown");
    expect(job.rate_min).toBeNull();
    expect(job.apply_url).toBe("https://careers.example.org/role");
  });
});
