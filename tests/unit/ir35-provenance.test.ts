import { describe, expect, it } from "vitest";
import { deriveIR35Provenance } from "@/lib/ir35-provenance";
import type { JobDetail } from "@/lib/job-types";

const baseJob: JobDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Platform Engineer Contract",
  company_name: "Example Ltd",
  location: "London, UK",
  remote_type: "hybrid",
  ir35_status: "outside",
  ir35_confidence: "medium",
  rate_min: 600,
  rate_max: 650,
  rate_currency: "GBP",
  rate_type: "daily",
  skills: ["AWS"],
  posted_at: "2026-08-19T00:00:00.000Z",
  first_seen_at: "2026-08-19T00:00:00.000Z",
  last_seen_at: "2026-08-20T00:00:00.000Z",
  description: "Six month contract. This engagement is Outside IR35.",
  apply_url: "https://jobs.example.com/platform",
  source_domain: "jobs.example.com",
};

describe("deriveIR35Provenance", () => {
  it("identifies explicit advertiser wording and preserves the matched phrase", () => {
    const result = deriveIR35Provenance(baseJob);
    expect(result.kind).toBe("advertised");
    expect(result.label).toBe("Advertiser-stated");
    expect(result.evidence).toMatch(/Outside IR35/i);
    expect(result.observedLabel).toBe("Evidence checked 20 August 2026");
  });

  it("separates arrangement inference from an explicit determination", () => {
    const result = deriveIR35Provenance({
      ...baseJob,
      ir35_status: "inside",
      description: "This engagement is available via umbrella company only.",
    });
    expect(result.kind).toBe("inferred");
    expect(result.shortLabel).toMatch(/Inferred/);
  });

  it("does not choose between conflicting statements", () => {
    const result = deriveIR35Provenance({
      ...baseJob,
      ir35_status: "unknown",
      ir35_confidence: "low",
      description: "Inside IR35 or Outside IR35 depending on the client determination.",
    });
    expect(result.kind).toBe("unconfirmed");
    expect(result.label).toBe("Conflicting advertiser wording");
  });

  it("flags a stored status that current text cannot reproduce", () => {
    const result = deriveIR35Provenance({ ...baseJob, description: "Six month contract." });
    expect(result.kind).toBe("source_or_review");
    expect(result.explanation).toMatch(/verify it on the original advert/i);
  });
});
