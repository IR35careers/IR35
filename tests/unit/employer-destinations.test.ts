import { describe, expect, it } from "vitest";
import { normaliseEmployerDestinations, validRecruitmentEmail } from "@/lib/employer-destinations";

describe("verified employer application destinations", () => {
  it("accepts real recruitment addresses and rejects placeholders", () => {
    expect(validRecruitmentEmail("recruitment@company.co.uk")).toBe(true);
    expect(validRecruitmentEmail("person@example.com")).toBe(false);
    expect(validRecruitmentEmail("not-an-email")).toBe(false);
  });

  it("keeps only the latest valid destination for each source", () => {
    const destinations = normaliseEmployerDestinations([
      {
        sourceId: "greenhouse:company",
        email: "old@company.co.uk",
        enabled: true,
        verifiedAt: "2026-08-21T07:00:00.000Z",
        updatedAt: "2026-08-21T07:00:00.000Z",
      },
      {
        sourceId: "greenhouse:company",
        email: "recruitment@company.co.uk",
        enabled: true,
        verifiedAt: "2026-08-21T08:00:00.000Z",
        updatedAt: "2026-08-21T08:00:00.000Z",
      },
      { sourceId: "lever:bad", email: "bad", verifiedAt: "today" },
    ]);
    expect(destinations).toEqual([{
      sourceId: "greenhouse:company",
      email: "recruitment@company.co.uk",
      enabled: true,
      verifiedAt: "2026-08-21T08:00:00.000Z",
      updatedAt: "2026-08-21T08:00:00.000Z",
    }]);
  });
});

