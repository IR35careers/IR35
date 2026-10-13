import { describe, expect, it } from "vitest";
import { HttpClient } from "@/lib/ats/http-client";
import { mapLeverJob } from "@/lib/ats/lever-fetcher";
import { mapWorkableJob } from "@/lib/ats/workable-fetcher";
import { fetchSmartRecruiters, mapSmartRecruitersJob } from "@/lib/ats/smartrecruiters-fetcher";
import { processRawJob } from "@/lib/processing/job-processor";
import type { CompanyConfig } from "@/lib/ats/types";

const company: CompanyConfig = { name: "UK Engineering", type: "smartrecruiters", slug: "uk-engineering" };
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("direct UK contract inventory", () => {
  it("accepts structured Lever contract commitments without inventing an IR35 status", () => {
    const raw = mapLeverJob({ id: "one", text: "Quality Inspector", country: "GB", categories: { location: "Worcester", commitment: "Contract: Part-Time" },
      descriptionPlain: "Inspect aerospace products and document compliance.", hostedUrl: "https://jobs.lever.co/example/one" }, company);
    const job = processRawJob(raw);
    expect(job).toMatchObject({ title: "Quality Inspector", ir35_status: "unknown", apply_url: "https://jobs.lever.co/example/one" });
  });

  it("excludes a permanent Workable Contract Manager despite the title", () => {
    const raw = mapWorkableJob({ title: "Contract Manager", shortcode: "perm", employment_type: "Full-time", country: "United Kingdom", city: "London",
      description: "Manage supplier contracts. Permanent role with a salary and pension.", url: "https://apply.workable.com/j/perm" }, company);
    expect(processRawJob(raw)).toBeNull();
  });

  it("retains advertised IR35 engagements even when the ATS labels them Full-time", () => {
    const raw = mapSmartRecruitersJob({ id: "rate", name: "User Researcher - Inside IR35 Contract", location: { country: "gb", city: "Leeds" },
      typeOfEmployment: { id: "permanent", label: "Full-time" }, applyUrl: "https://jobs.smartrecruiters.com/example/rate",
      jobAd: { sections: { jobDescription: { text: "Day rate contract, £550 per day, inside IR35." } } } }, company);
    expect(processRawJob(raw)).toMatchObject({ ir35_status: "inside", rate_min: 550, rate_type: "daily" });
  });

  it("uses the UK country filter and keeps live contracts when another detail has disappeared", async () => {
    const urls: URL[] = [];
    const client = new HttpClient({ minDelayMs: 0, maxRetries: 0, fetchImpl: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith("/gone")) return new Response("withdrawn", { status: 404 });
      if (url.pathname.endsWith("/live")) return response({ id: "live", name: "Security Engineer", location: { country: "gb", city: "Blackwood" },
        typeOfEmployment: { id: "contract", label: "Contract (Ltd)" }, applyUrl: "https://jobs.smartrecruiters.com/example/live",
        jobAd: { sections: { jobDescription: { text: "Six month contract, outside IR35." } } } });
      return response({ totalFound: 3, content: [
        { id: "live", name: "Security Engineer", location: { country: "gb" }, typeOfEmployment: { id: "contract", label: "Contract" } },
        { id: "gone", name: "Contract Data Engineer", location: { country: "gb" }, typeOfEmployment: { id: "contract", label: "Contract" } },
        { id: "perm", name: "Supplier Manager", location: { country: "gb" }, typeOfEmployment: { id: "permanent", label: "Full-time" },
          customField: [{ fieldLabel: "Contract type", valueLabel: "Permanent contract" }] },
      ] });
    } });
    const jobs = await fetchSmartRecruiters(client, company);
    expect(jobs).toHaveLength(1);
    expect(processRawJob(jobs[0])).toMatchObject({ ir35_status: "outside" });
    expect(urls[0].searchParams.get("country")).toBe("gb");
    expect(urls.some((url) => url.pathname.endsWith("/perm"))).toBe(false);
  });
});
