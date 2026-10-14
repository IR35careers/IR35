import { describe, expect, it } from "vitest";
import { applicationOpeningDismissPattern, matchesApplicationAction, shouldDismissApplicationOpeningAction } from "@/lib/application-runner/ats";

describe("ready employer form navigation", () => {
  it("matches cookie text, value and accessible name separately", () => {
    expect(matchesApplicationAction(applicationOpeningDismissPattern(true), ["Reject all", "deny", "Reject optional cookies"])).toBe(true);
    expect(matchesApplicationAction(applicationOpeningDismissPattern(true), ["No thanks", "cancel", "No thanks"])).toBe(false);
  });
  it("does not abandon a ready application using No thanks", () => {
    for (const label of ["No thanks", "No, thanks", "No thanks, take me to the job", "Continue to job"]) {
      expect(shouldDismissApplicationOpeningAction({ label, hasApplicationForm: true })).toBe(false);
    }
  });
  it("still rejects optional cookies on an application form", () => {
    for (const label of ["Reject all", "Reject optional cookies", "Only necessary cookies"]) {
      expect(shouldDismissApplicationOpeningAction({ label, hasApplicationForm: true })).toBe(true);
    }
  });
  it("can reach a job when an actual application form is not open", () => {
    expect(shouldDismissApplicationOpeningAction({ label: "Take me to the job", hasApplicationForm: false })).toBe(true);
    expect(shouldDismissApplicationOpeningAction({ label: "Submit application", hasApplicationForm: false })).toBe(false);
  });
});
