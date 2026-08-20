import { describe, expect, it } from "vitest";
import {
  hasStatedSponsorship,
  isRateTypeFilter,
  isSeniorityFilter,
  matchesSeniorityTitle,
  seniorityPostgrestFilter,
  SPONSORSHIP_POSTGREST,
} from "@/lib/job-search-filters";

describe("advanced job search filters", () => {
  it("matches only the requested title seniority group", () => {
    expect(matchesSeniorityTitle("Senior Platform Engineer", "senior")).toBe(true);
    expect(matchesSeniorityTitle("Data Migration Lead", "lead")).toBe(true);
    expect(matchesSeniorityTitle("Head of Delivery", "manager")).toBe(true);
    expect(matchesSeniorityTitle("Graduate Business Analyst", "entry")).toBe(true);
    expect(matchesSeniorityTitle("Platform Engineer", "senior")).toBe(false);
  });

  it("does not treat a negative sponsorship statement as an offer", () => {
    expect(hasStatedSponsorship("Visa sponsorship is available for this engagement.")).toBe(true);
    expect(hasStatedSponsorship("We can sponsor a Skilled Worker visa.")).toBe(true);
    expect(hasStatedSponsorship("Visa sponsorship is not available.")).toBe(false);
    expect(hasStatedSponsorship("You must already have the right to work in the UK.")).toBe(false);
  });

  it("accepts only published filter values", () => {
    expect(isSeniorityFilter("lead")).toBe(true);
    expect(isSeniorityFilter("all")).toBe(false);
    expect(isRateTypeFilter("daily")).toBe(true);
    expect(isRateTypeFilter("salary")).toBe(false);
  });

  it("uses hard-coded PostgREST filters without user input", () => {
    expect(seniorityPostgrestFilter("senior")).toContain("title.ilike.%senior%");
    expect(SPONSORSHIP_POSTGREST).toContain("description.ilike.%we can sponsor%");
  });
});
