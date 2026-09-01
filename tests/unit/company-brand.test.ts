import { describe, expect, it } from "vitest";
import {
  getCompanyInitials,
  getCompanyLogoDomain,
  getCompanyLogoPath,
  normaliseCompanyName,
} from "@/lib/company-brand";

describe("company brand resolver", () => {
  it("normalises punctuation, casing and corporate suffixes safely", () => {
    expect(normaliseCompanyName("Rathbones Group Plc")).toBe("rathbones group plc");
    expect(getCompanyLogoDomain("Rathbones Group Plc")).toBe("rathbones.com");
    expect(getCompanyLogoDomain("JAM Recruitment Ltd")).toBe("jamrecruitment.co.uk");
  });

  it("resolves feed aliases to verified employer domains", () => {
    expect(getCompanyLogoDomain("Morson Edge")).toBe("morson.com");
    expect(getCompanyLogoDomain("Public Sector Resourcing CWS")).toBe("publicsectorresourcing.co.uk");
    expect(getCompanyLogoPath("RNLI")).toBe("/api/company-logo?company=RNLI");
  });

  it("does not guess a domain for an unknown company", () => {
    expect(getCompanyLogoDomain("A Completely New Employer")).toBeNull();
    expect(getCompanyLogoPath("A Completely New Employer")).toBeNull();
    expect(getCompanyInitials("A Completely New Employer")).toBe("AC");
  });
});

