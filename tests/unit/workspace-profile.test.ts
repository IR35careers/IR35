import { describe, expect, it } from "vitest";
import { createBlankCloudWorkspaceState } from "@/lib/workspace/repository";
import { evaluateProfileReadiness } from "@/lib/workspace/profile-readiness";

describe("new contractor profile", () => {
  it("never inherits fictional preview identity or CV evidence", () => {
    const state = createBlankCloudWorkspaceState("new.contractor@example.com");

    expect(state.profile).toMatchObject({
      fullName: "",
      email: "new.contractor@example.com",
      phone: "",
      targetRole: "",
      skills: [],
      certifications: [],
      resumeProfiles: [],
      rightToWork: "prefer_not_to_say",
    });
    expect(state.profile.professionalSummary).toBe("");
    expect(state.profile.experienceText).toBe("");
    expect(state.profile.profileSetupCompletedAt).toBeUndefined();
  });

  it("requires real user information before an application can start", () => {
    const state = createBlankCloudWorkspaceState("new.contractor@example.com");
    const readiness = evaluateProfileReadiness(state.profile, "");

    expect(readiness.complete).toBe(false);
    expect(readiness.missing.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "full-name",
        "phone",
        "address",
        "target-role",
        "skills",
        "right-to-work",
        "cv",
      ]),
    );
  });
});
