import { describe, expect, it } from "vitest";
import { cvDisplayTitle, isPlausibleCandidateName, isPlausibleContactLocation, normaliseExtractedCvText, normalisePdfTextItems, resolveCvCandidateName } from "@/lib/resume/identity";
import { extractResumeProfile } from "@/lib/resume/profile-extraction";
import { parseResumeText } from "@/lib/resume/analysis";
import { resolveCandidateName } from "@/lib/candidate-name";

const spacedCv = "Cloud Platforms\nRBAC, IAM\nA L E X   M O R G A N\nSenior DevOps Engineer\nalex@example.com | +44 7700 900123 | Bristol, UK\n\nTECHNICAL SKILLS\nAWS, Terraform, Kubernetes";

describe("CV identity evidence", () => {
  it("repairs spaced letters without deleting the real word gap or rewriting normal prose", () => {
    expect(normaliseExtractedCvText("A L E X   M O R G A N\nP R O F I L E\nBuilt AWS APIs and R & D systems.\nA B C Smith"))
      .toBe("ALEX   MORGAN\nPROFILE\nBuilt AWS APIs and R & D systems.\nA B C Smith");
  });
  it("protects PDF.js word separators before repairing letter-spaced items", () => {
    expect(normalisePdfTextItems([[{ str: "A L E X", hasEOL: false }, { str: " ", hasEOL: false },
      { str: "M O R G A N", hasEOL: true }]])).toBe("ALEX MORGAN");
    expect(normalisePdfTextItems([[{ str: "A B C", hasEOL: false }, { str: " ", hasEOL: false },
      { str: "Smith", hasEOL: true }]])).toBe("A B C Smith");
  });
  it.each(["Cloud Platforms", "RBAC IAM", "Technical Skills", "Security Clearance", "Milton Keynes", "United Kingdom", "Full Name", "Application Details", "Built reliable systems"])("rejects a heading or place as a person: %s", value => {
    expect(isPlausibleCandidateName(value)).toBe(false);
  });
  it.each(["Alex Morgan", "ALEX MORGAN", "A B C Smith", "María-José O’Neill", "李 小龍", "Jean de la Fontaine", "John Cloud"])("retains names without a given-name dictionary: %s", value => {
    expect(isPlausibleCandidateName(value)).toBe(true);
  });
  it("uses the real identity and contact place rather than the reported technical headings", () => {
    expect(extractResumeProfile(spacedCv).prefill).toMatchObject({ fullName: "ALEX MORGAN", location: "Bristol, UK" });
    expect(parseResumeText(spacedCv).candidateName).toBe("ALEX MORGAN");
    expect(resolveCandidateName("Cloud Platforms", spacedCv)).toBe("ALEX MORGAN");
  });
  it("leaves an unrecoverable word boundary for review, never a heading fallback", () => {
    const ambiguous = spacedCv.replace("A L E X   M O R G A N", "A L E X M O R G A N");
    expect(extractResumeProfile(ambiguous).prefill.fullName).toBeUndefined();
    expect(parseResumeText(ambiguous).candidateName).toBe("Candidate");
  });
  it("requires place evidence and supports an explicitly labelled uncommon town", () => {
    expect(isPlausibleContactLocation("RBAC, IAM", true)).toBe(false);
    expect(isPlausibleContactLocation("Reliable delivery systems")).toBe(false);
    expect(isPlausibleContactLocation("Remote", true)).toBe(false);
    expect(extractResumeProfile("Alex Morgan\nLocation: Billericay\nalex@example.com").prefill.location).toBe("Billericay");
  });
  it("does not turn a skills-only document into identity fields", () => {
    const result = extractResumeProfile("Cloud Platforms\nRBAC, IAM\nTECHNICAL SKILLS\nAWS, Terraform");
    expect(result.prefill.fullName).toBeUndefined();
    expect(result.prefill.location).toBeUndefined();
  });
  it("checks the parsed profile hostname rather than a domain substring", () => {
    expect(extractResumeProfile("Alex Morgan\nhttps://github.com/alex | Billericay").prefill.location).toBe("Billericay");
    expect(extractResumeProfile("Alex Morgan\nhttps://github.com.attacker.example/alex | Billericay").prefill.location).toBeUndefined();
    expect(extractResumeProfile("Alex Morgan\nhttps://attacker.example/github.com/alex | Billericay").prefill.location).toBeUndefined();
  });
  it("does not manufacture a postal address from skills preceding a lone postcode", () => {
    const result = extractResumeProfile("Cloud Platforms\nRBAC, IAM\nBS1 4ST");
    expect(result.prefill).toMatchObject({ postcode: "BS1 4ST", country: "United Kingdom" });
    expect(result.prefill.city).toBeUndefined();
    expect(result.prefill.addressLine1).toBeUndefined();
    expect(result.prefill.location).toBeUndefined();
  });
  it("honours the explicitly supplied user's name for presentation and uses a neutral unknown title", () => {
    expect(resolveCvCandidateName("Priya Shah", "Alex Morgan")).toBe("Priya Shah");
    expect(cvDisplayTitle("Priya Shah", "Cloud Platforms")).toBe("Priya Shah CV");
    expect(cvDisplayTitle("Björk")).toBe("Björk CV");
    expect(cvDisplayTitle(undefined, "Cloud Platforms")).toBe("Your CV");
    expect(resolveCandidateName("Contractor", "Cloud Platforms\nRBAC, IAM")).toBeNull();
  });
});
